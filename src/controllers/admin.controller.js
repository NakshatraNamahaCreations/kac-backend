const { z } = require('zod');
const bcrypt = require('bcryptjs');
const { UserModel } = require('../models/User');
const { VendorModel } = require('../models/Vendor');
const { AgentModel } = require('../models/Agent');
const { EmployeeModel } = require('../models/Employee');
const { BookingModel } = require('../models/Booking');
const { env } = require('../config/env');
const { signAdminToken } = require('../lib/jwt');
const { fail } = require('../lib/httpError');
const { buildPage, parseCursor } = require('../lib/pagination');
const { customerReferralCode, vendorReferralCode, agentReferralCode } = require('../lib/referralCode');

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const loginSchema = z.object({ username: z.string().min(1), password: z.string().min(1) });

async function adminLogin(req, res) {
  const body = loginSchema.parse(req.body);
  const validUsername = body.username === env.adminUsername;
  const validPassword = validUsername && bcrypt.compareSync(body.password, env.adminPasswordHash);
  if (!validUsername || !validPassword) {
    fail(401, 'INVALID_CREDENTIALS', 'Invalid username or password.');
  }
  res.json({ accessToken: signAdminToken() });
}

async function getStats(_req, res) {
  const [customers, vendors, agents, employees, bookingsByStatus] = await Promise.all([
    UserModel.countDocuments({ roles: 'customer' }),
    VendorModel.countDocuments(),
    AgentModel.countDocuments(),
    EmployeeModel.countDocuments(),
    BookingModel.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
  ]);
  const byStatus = Object.fromEntries(bookingsByStatus.map((s) => [s._id, s.count]));
  const totalBookings = bookingsByStatus.reduce((sum, s) => sum + s.count, 0);
  res.json({
    customers,
    vendors,
    agents,
    employees,
    bookings: {
      total: totalBookings,
      requested: byStatus.REQUESTED ?? 0,
      accepted: byStatus.ACCEPTED ?? 0,
      inProgress: byStatus.IN_PROGRESS ?? 0,
      completed: byStatus.COMPLETED ?? 0,
      declined: byStatus.DECLINED ?? 0,
      cancelled: byStatus.CANCELLED ?? 0,
    },
  });
}

// Vendor/Agent/Employee each live in their own collection (see the model
// files) rather than one unified "users" table, so listing a specific role
// queries that role's own collection directly instead of joining. Agent and
// Employee don't denormalize name/phone onto themselves (Vendor does), so
// those two populate the User relation for display.
async function listUsers(req, res) {
  const role = typeof req.query.role === 'string' ? req.query.role : 'all';
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const skip = parseCursor(typeof req.query.cursor === 'string' ? req.query.cursor : undefined);
  const limit = 20;
  const searchRe = search ? new RegExp(escapeRegex(search), 'i') : null;

  if (role === 'vendor') {
    const filter = searchRe ? { $or: [{ name: searchRe }, { phone: searchRe }] } : {};
    const [total, vendors] = await Promise.all([
      VendorModel.countDocuments(filter),
      VendorModel.find(filter).sort({ joinedAt: -1 }).skip(skip).limit(limit),
    ]);
    const data = vendors.map((v) => ({
      id: v.id,
      name: v.name,
      phone: v.phone,
      role: 'vendor',
      area: v.area,
      referralCode: v.referralCode,
      verificationStatus: v.verificationStatus,
      plan: v.plan,
      joinedAt: v.joinedAt,
    }));
    return res.json(buildPage(data, skip, limit, total));
  }

  if (role === 'agent') {
    const userIds = searchRe
      ? (await UserModel.find({ $or: [{ name: searchRe }, { phone: searchRe }] }).select('_id')).map((u) => u._id)
      : null;
    const filter = userIds ? { userId: { $in: userIds } } : {};
    const [total, agents] = await Promise.all([
      AgentModel.countDocuments(filter),
      AgentModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('userId', 'name phone'),
    ]);
    const data = agents.map((a) => ({
      id: a.id,
      name: a.userId?.name ?? 'Agent',
      phone: a.userId?.phone ?? '',
      role: 'agent',
      area: a.area ?? null,
      referralCode: a.executiveCode,
      walletCoins: a.walletCoins,
      joinedAt: a.createdAt,
    }));
    return res.json(buildPage(data, skip, limit, total));
  }

  if (role === 'employee') {
    const userIds = searchRe
      ? (await UserModel.find({ $or: [{ name: searchRe }, { phone: searchRe }] }).select('_id')).map((u) => u._id)
      : null;
    const filter = userIds ? { userId: { $in: userIds } } : {};
    const [total, employees] = await Promise.all([
      EmployeeModel.countDocuments(filter),
      EmployeeModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('userId', 'name phone'),
    ]);
    const data = employees.map((e) => ({
      id: e.id,
      name: e.userId?.name ?? 'Employee',
      phone: e.userId?.phone ?? '',
      role: 'employee',
      area: e.areaAssigned,
      referralCode: e.referralCode,
      employeeId: e.employeeId,
      joinedAt: e.createdAt,
    }));
    return res.json(buildPage(data, skip, limit, total));
  }

  // 'all' or 'customer' — every person has a User row regardless of role,
  // so this is the base table; 'all' shows everyone, 'customer' narrows to
  // people holding the customer role specifically.
  const filter = {};
  if (role === 'customer') filter.roles = 'customer';
  if (searchRe) filter.$or = [{ name: searchRe }, { phone: searchRe }];
  const [total, users] = await Promise.all([
    UserModel.countDocuments(filter),
    UserModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
  ]);
  const data = users.map((u) => ({
    id: u.id,
    name: u.name,
    phone: u.phone,
    role: u.roles.length ? u.roles.join(', ') : 'customer',
    roles: u.roles,
    area: u.area,
    referralCode: u.referralCode,
    walletCoins: u.walletCoins,
    joinedAt: u.createdAt,
  }));
  res.json(buildPage(data, skip, limit, total));
}

// Sequential-looking ids (EMP-1001, EMP-1002, ...) — admin-direct-create has
// no HR-issued seed row to borrow one from (see employee.controller.js's
// self-service registerEmployee, which reads employeeId off a pre-seeded
// EmployeeVerificationSeed), so mint a fresh one here instead. The loop
// guards the unlikely case of a collision with an id issued some other way.
async function nextEmployeeId() {
  const count = await EmployeeModel.countDocuments();
  let n = 1001 + count;
  for (;;) {
    const candidate = `EMP-${n}`;
    // eslint-disable-next-line no-await-in-loop
    const exists = await EmployeeModel.exists({ employeeId: candidate });
    if (!exists) return candidate;
    n += 1;
  }
}

const createUserSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(6),
  role: z.enum(['customer', 'vendor', 'agent', 'employee']),
  area: z.string().optional(),
  categoryId: z.string().optional(),
});

// Admin-direct-create: unlike the mobile app's own registration flows (which
// require OTP-verified login before granting a role), the admin can hand a
// role straight to a phone number. That person can then log in normally via
// OTP any time after — this just pre-provisions the account + role record.
async function createUser(req, res) {
  const body = createUserSchema.parse(req.body);

  if (body.role === 'vendor' && !body.categoryId) {
    fail(400, 'CATEGORY_REQUIRED', 'Pick a category for the vendor.');
  }
  if ((body.role === 'vendor' || body.role === 'employee') && !body.area) {
    fail(400, 'AREA_REQUIRED', 'Area is required for this role.');
  }

  let user = await UserModel.findOne({ phone: body.phone });
  if (!user) {
    user = await UserModel.create({ phone: body.phone, name: body.name, roles: [] });
  } else if (!user.name) {
    user.name = body.name;
  }

  const isNewRole = !user.roles.includes(body.role);
  const result = { userId: user.id, name: user.name, phone: user.phone, role: body.role };

  if (body.role === 'customer') {
    if (!user.referralCode) user.referralCode = customerReferralCode(String(user._id));
    result.referralCode = user.referralCode;
  } else if (body.role === 'vendor') {
    let vendor = await VendorModel.findOne({ userId: user._id });
    if (!vendor) {
      vendor = await VendorModel.create({
        userId: user._id,
        name: body.name,
        primaryCategoryId: body.categoryId,
        categories: [body.categoryId],
        area: body.area,
        phone: user.phone,
        whatsapp: user.phone,
        // No lat/lng captured in the admin form — same Bengaluru placeholder
        // used by the mobile app's own registerVendor fallback; the vendor
        // fills in their real location later from their own app.
        geo: { lat: 12.9716, lng: 77.5946 },
        verificationStatus: 'PENDING_VERIFICATION',
      });
      vendor.referralCode = vendorReferralCode(String(vendor._id));
      await vendor.save();
    }
    result.referralCode = vendor.referralCode;
    result.recordId = vendor.id;
  } else if (body.role === 'agent') {
    let agent = await AgentModel.findOne({ userId: user._id });
    if (!agent) {
      agent = await AgentModel.create({
        userId: user._id,
        executiveCode: agentReferralCode(String(user._id)),
        area: body.area,
        bankAccounts: [],
        walletCoins: 0,
      });
    }
    result.referralCode = agent.executiveCode;
    result.recordId = agent.id;
  } else if (body.role === 'employee') {
    let employee = await EmployeeModel.findOne({ userId: user._id });
    if (!employee) {
      const employeeId = await nextEmployeeId();
      employee = await EmployeeModel.create({
        userId: user._id,
        employeeId,
        referralCode: `GK-EMP-${employeeId.replace(/^EMP-/, '')}`,
        areaAssigned: body.area,
      });
    }
    result.referralCode = employee.referralCode;
    result.employeeId = employee.employeeId;
    result.recordId = employee.id;
  }

  if (isNewRole) user.roles.push(body.role);
  await user.save();

  res.status(201).json(result);
}

async function listBookings(req, res) {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const skip = parseCursor(typeof req.query.cursor === 'string' ? req.query.cursor : undefined);
  const limit = 20;

  const filter = {};
  if (status) filter.status = status;
  if (search) {
    const re = new RegExp(escapeRegex(search), 'i');
    filter.$or = [{ customerName: re }, { vendorName: re }, { serviceName: re }];
  }

  const [total, bookings] = await Promise.all([
    BookingModel.countDocuments(filter),
    BookingModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
  ]);
  res.json(buildPage(bookings.map((b) => b.toJSON()), skip, limit, total));
}

module.exports = {
  adminLogin,
  getStats,
  listUsers,
  createUser,
  listBookings,
};
