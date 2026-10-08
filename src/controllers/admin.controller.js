const { z } = require('zod');
const bcrypt = require('bcryptjs');
const { UserModel } = require('../models/User');
const { VendorModel } = require('../models/Vendor');
const { AgentModel, effectiveAgentStatus } = require('../models/Agent');
const { EmployeeModel } = require('../models/Employee');
const { BookingModel } = require('../models/Booking');
const { OnboardingModel } = require('../models/Onboarding');
const { CategoryModel } = require('../models/Category');
const { AdminModel } = require('../models/Admin');
const { env } = require('../config/env');
const { signAdminToken } = require('../lib/jwt');
const { fail } = require('../lib/httpError');
const { buildPage, parseCursor } = require('../lib/pagination');
const { customerReferralCode, vendorReferralCode, agentReferralCode } = require('../lib/referralCode');
const { normalizePhone } = require('../lib/phone');
const { io } = require('../realtime/socket');
const { decryptAadhaar, decryptSecret } = require('../lib/aadhaarVault');

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A vendor's code is the same hash the vendor app shows on its Profile /
// Share screens (vendorReferralCode(vendor id)). Vendors registered before
// the code was stored have none on the document — which also means
// creditVendorReferrer (a lookup BY stored code) could never credit them.
// Backfill it the first time the admin panel reads such a vendor.
async function ensureVendorReferralCode(vendor) {
  if (vendor.referralCode) return vendor.referralCode;
  vendor.referralCode = vendorReferralCode(String(vendor._id));
  await vendor.save();
  return vendor.referralCode;
}

// Every referral code one person holds, one per role — a vendor who is also
// a customer has both a GK-CU- and a GK-VND- code, and the admin's "All"
// list used to show only the customer one. `users` is a page of User docs.
async function referralCodesByUser(users) {
  const ids = users.map((u) => u._id);
  const [vendors, agents, employees] = await Promise.all([
    VendorModel.find({ userId: { $in: ids } }),
    AgentModel.find({ userId: { $in: ids } }, 'userId executiveCode'),
    EmployeeModel.find({ userId: { $in: ids } }, 'userId referralCode'),
  ]);
  const byUser = new Map(users.map((u) => [
    String(u._id),
    [{ role: 'customer', code: u.referralCode || customerReferralCode(String(u._id)) }],
  ]));
  for (const v of vendors) {
    byUser.get(String(v.userId))?.push({ role: 'vendor', code: await ensureVendorReferralCode(v) });
  }
  for (const a of agents) {
    if (a.executiveCode) byUser.get(String(a.userId))?.push({ role: 'agent', code: a.executiveCode });
  }
  for (const e of employees) {
    if (e.referralCode) byUser.get(String(e.userId))?.push({ role: 'employee', code: e.referralCode });
  }
  return byUser;
}

const loginSchema = z.object({ username: z.string().min(1), password: z.string().min(1) });

// DB-backed admin (Admin.js) is checked first — this is what POST
// /admin/setup creates. Falls back to the env-var admin (config/env.js) if
// no DB row matches, so the env-based login (Render's ADMIN_USERNAME/
// ADMIN_PASSWORD_HASH) keeps working as a break-glass fallback even after
// you've switched to DB-stored credentials.
async function adminLogin(req, res) {
  const body = loginSchema.parse(req.body);

  const dbAdmin = await AdminModel.findOne({ username: body.username });
  if (dbAdmin) {
    if (!bcrypt.compareSync(body.password, dbAdmin.passwordHash)) {
      fail(401, 'INVALID_CREDENTIALS', 'Invalid username or password.');
    }
    res.json({ accessToken: signAdminToken() });
    return;
  }

  const validUsername = body.username === env.adminUsername;
  const validPassword = validUsername && bcrypt.compareSync(body.password, env.adminPasswordHash);
  if (!validUsername || !validPassword) {
    fail(401, 'INVALID_CREDENTIALS', 'Invalid username or password.');
  }
  res.json({ accessToken: signAdminToken() });
}

// One-time bootstrap — creates the first DB-stored admin. Deliberately
// unauthenticated (there's no admin token to require before one exists),
// so the ONLY safety control is refusing to run again once any row exists.
// Without this guard it would be a permanent open door to create admin
// accounts, which is why it hard-fails rather than e.g. upserting.
async function adminSetup(req, res) {
  const body = loginSchema.parse(req.body);
  const existing = await AdminModel.countDocuments();
  if (existing > 0) {
    fail(409, 'ALREADY_SET_UP', 'An admin account already exists. Use /admin/change-password instead.');
  }
  await AdminModel.create({
    username: body.username,
    passwordHash: bcrypt.hashSync(body.password, 10),
  });
  res.status(201).json({ username: body.username });
}

const changePasswordSchema = z.object({
  username: z.string().min(1),
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6),
});

// Requires the CURRENT password (not just a valid admin session) so a
// leaked/long-lived admin token alone can't be used to lock out the real
// admin by silently rotating the password out from under them.
async function adminChangePassword(req, res) {
  const body = changePasswordSchema.parse(req.body);
  const admin = await AdminModel.findOne({ username: body.username });
  if (!admin || !bcrypt.compareSync(body.currentPassword, admin.passwordHash)) {
    fail(401, 'INVALID_CREDENTIALS', 'Current username or password is incorrect.');
  }
  admin.passwordHash = bcrypt.hashSync(body.newPassword, 10);
  await admin.save();
  res.status(204).send();
}

async function getStats(_req, res) {
  const [customers, vendors, agents, employees, bookingsByStatus, allBookings] = await Promise.all([
    UserModel.countDocuments({ roles: 'customer' }),
    VendorModel.countDocuments(),
    AgentModel.countDocuments(),
    EmployeeModel.countDocuments(),
    BookingModel.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    // Only createdAt is needed for the trend below — avoid pulling full
    // documents for what could eventually be a large collection.
    BookingModel.find({}).select('createdAt'),
  ]);
  const byStatus = Object.fromEntries(bookingsByStatus.map((s) => [s._id, s.count]));
  const totalBookings = bookingsByStatus.reduce((sum, s) => sum + s.count, 0);

  // Last 6 months, oldest first — mirrors the exact windowing pattern in
  // employee.controller.js's getEmployeeDashboard for consistency.
  const now = new Date();
  const trend = [];
  for (let i = 5; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    const count = allBookings.filter((b) => b.createdAt >= start && b.createdAt < end).length;
    trend.push({ month: start.toLocaleString('en-US', { month: 'short' }), bookings: count });
  }

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
      trend,
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
    const codes = await Promise.all(vendors.map(ensureVendorReferralCode));
    const data = vendors.map((v, i) => ({
      id: v.id,
      name: v.name,
      phone: v.phone,
      role: 'vendor',
      area: v.area,
      referralCode: codes[i],
      verificationStatus: v.verificationStatus,
      plan: v.plan,
      joinedAt: v.joinedAt,
    }));
    return res.json(buildPage(data, skip, limit, total));
  }

  if (role === 'agent') {
    // Only people who actually registered as agents — vendors also get a
    // wallet-only Agent document (agent.controller.js requireOwnAgent).
    const agentUserFilter = { roles: 'agent', ...(searchRe ? { $or: [{ name: searchRe }, { phone: searchRe }] } : {}) };
    const userIds = (await UserModel.find(agentUserFilter).select('_id')).map((u) => u._id);
    const filter = { userId: { $in: userIds } };
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
      verificationStatus: effectiveAgentStatus(a),
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
  const codesByUser = await referralCodesByUser(users);
  const data = users.map((u) => ({
    id: u.id,
    name: u.name,
    phone: u.phone,
    role: u.roles.length ? u.roles.join(', ') : 'customer',
    roles: u.roles,
    area: u.area,
    referralCode: u.referralCode || customerReferralCode(String(u._id)),
    referralCodes: codesByUser.get(String(u._id)) ?? [],
    walletCoins: u.walletCoins,
    joinedAt: u.createdAt,
  }));
  res.json(buildPage(data, skip, limit, total));
}

// Full record for one user, keyed by the SAME (role, id) pair a listUsers
// row carries — id is that role's own document id (Vendor/Agent/Employee
// id, or User id for customer/all), not always a User id. Kept as a
// separate on-demand call rather than bloating every listUsers row with
// full bank/KYC/services payloads that most views never render.
async function getUserDetail(req, res) {
  const { role, id } = req.params;

  if (role === 'vendor') {
    const vendor = await VendorModel.findById(id);
    if (!vendor) fail(404, 'NOT_FOUND', 'Vendor not found.');
    await ensureVendorReferralCode(vendor);
    // Category ids -> names for display.
    const cats = await CategoryModel.find({ _id: { $in: vendor.categories ?? [] } }, 'name');
    // A vendor's wallet lives on their Agent document.
    const wallet = await AgentModel.findOne({ userId: vendor.userId }, 'walletCoins');
    const nameById = new Map(cats.map((c) => [String(c._id), c.name]));
    // Full Aadhaar (admin only): decrypt the stored copy; for vendors an agent
    // onboarded before encryption existed, the Onboarding row still has it.
    const json = vendor.toJSON();
    let aadhaarNumber = decryptAadhaar(vendor.kyc?.aadhaarNumberEnc);
    if (!aadhaarNumber) {
      const ob = await OnboardingModel.findOne(
        { vendorPhone: vendor.phone, aadhaarNumber: { $nin: [null, ''] } },
        'aadhaarNumber',
      ).sort({ createdAt: -1 });
      aadhaarNumber = ob?.aadhaarNumber ?? null;
    }
    return res.json({
      role: 'vendor',
      ...json,
      kyc: { ...(json.kyc ?? {}), aadhaarNumber },
      bank: json.bank ? { ...json.bank, accountNumber: decryptSecret(vendor.bank?.accountNumberEnc) } : json.bank,
      categoryNames: (vendor.categories ?? []).map((c) => nameById.get(String(c)) ?? c),
      walletCoins: wallet?.walletCoins ?? 0,
    });
  }

  if (role === 'agent') {
    const agent = await AgentModel.findById(id).populate('userId', 'name phone area address');
    if (!agent) fail(404, 'NOT_FOUND', 'Agent not found.');
    const { userId, ...rest } = agent.toJSON();
    rest.kyc = { ...(rest.kyc ?? {}), aadhaarNumber: decryptAadhaar(agent.kyc?.aadhaarNumberEnc) };
    rest.bankAccounts = (rest.bankAccounts ?? []).map((b, i) => ({
      ...b,
      accountNumber: decryptSecret(agent.bankAccounts[i]?.accountNumberEnc),
    }));
    // Every vendor this agent onboarded in person, with what they collected
    // (KYC photo keys are viewable through GET /admin/uploads/:id). The full
    // Aadhaar number is stored on Onboarding (admin-only endpoint).
    const onboardings = await OnboardingModel.find({ agentId: agent.userId }).sort({ createdAt: -1 }).limit(100);
    return res.json({
      role: 'agent',
      ...rest,
      userId: userId?._id ? String(userId._id) : null,
      verificationStatus: effectiveAgentStatus(agent),
      verified: effectiveAgentStatus(agent) === 'ACTIVE',
      name: userId?.name,
      phone: userId?.phone,
      area: rest.area ?? userId?.area,
      address: userId?.address,
      onboardings: onboardings.map((o) => ({
        id: String(o._id),
        createdAt: o.createdAt,
        status: o.status,
        plan: o.plan,
        prepaid: o.prepaid,
        vendorName: o.vendorName,
        businessName: o.businessName ?? null,
        ownerName: o.ownerName ?? null,
        vendorPhone: o.vendorPhone,
        area: o.area ?? null,
        aadhaarNumber: o.aadhaarNumber ?? null,
        aadhaarNumberMasked: o.aadhaarNumber ? `XXXX XXXX ${String(o.aadhaarNumber).slice(-4)}` : null,
        aadhaarName: o.aadhaarName ?? null,
        panNumber: o.panNumber ?? null,
        gstNumber: o.gstNumber ?? null,
        establishedYear: o.establishedYear ?? null,
        aadhaarPhotoKey: o.aadhaarPhotoKey ?? null,
        panPhotoKey: o.panPhotoKey ?? null,
        gstPhotoKey: o.gstPhotoKey ?? null,
        shopPhotoKey: o.shopPhotoKey ?? null,
        earningsCoins: o.earningsCoins,
      })),
    });
  }

  if (role === 'employee') {
    const employee = await EmployeeModel.findById(id).populate('userId', 'name phone address');
    if (!employee) fail(404, 'NOT_FOUND', 'Employee not found.');
    const { userId, ...rest } = employee.toJSON();
    return res.json({ role: 'employee', ...rest, name: userId?.name, phone: userId?.phone, address: userId?.address });
  }

  const user = await UserModel.findById(id).select('-pushTokens');
  if (!user) fail(404, 'NOT_FOUND', 'User not found.');
  const codes = (await referralCodesByUser([user])).get(String(user._id)) ?? [];
  res.json({
    role: 'customer',
    ...user.toJSON(),
    referralCode: user.referralCode || customerReferralCode(String(user._id)),
    referralCodes: codes,
  });
}

const updateVendorVerificationSchema = z.object({ verified: z.boolean() });

// `verified` (the badge customers see on VendorCard/VendorProfileScreen)
// and `verificationStatus` (PENDING_PAYMENT/PENDING_VERIFICATION/ACTIVE/
// SUSPENDED) used to be two dead-end fields with nothing to ever move them
// past their creation-time default — this admin action is what finally
// drives both. Kept in lockstep here rather than exposed as two separate
// controls since nothing else in the app treats them as independent (a
// vendor is either fully live or it isn't).
async function updateVendorVerification(req, res) {
  const { verified } = updateVendorVerificationSchema.parse(req.body);
  const vendor = await VendorModel.findById(req.params.id);
  if (!vendor) fail(404, 'NOT_FOUND', 'Vendor not found.');

  vendor.verified = verified;
  vendor.verificationStatus = verified ? 'ACTIVE' : 'PENDING_VERIFICATION';
  await vendor.save();

  // SocketProvider.jsx's 'vendor.verified' case already expects exactly
  // this event/payload shape — it was just never emitted from anywhere
  // server-side until now, so a verified vendor's own app never updated
  // live without a manual refresh.
  io()?.to(`user:${String(vendor.userId)}`).emit('vendor.verified', {
    status: vendor.verificationStatus,
  });

  res.json(vendor.toJSON());
}

// Agent counterpart of updateVendorVerification: approves (ACTIVE) or
// un-approves (PENDING_VERIFICATION) an agent. Until approved, the agent app
// shows a "waiting for approval" screen and agent.routes.js refuses
// onboarding (requireActiveAgent).
async function updateAgentVerification(req, res) {
  const { verified } = updateVendorVerificationSchema.parse(req.body);
  const agent = await AgentModel.findById(req.params.id);
  if (!agent) fail(404, 'NOT_FOUND', 'Agent not found.');

  agent.verified = verified;
  agent.verificationStatus = verified ? 'ACTIVE' : 'PENDING_VERIFICATION';
  await agent.save();

  // SocketProvider.jsx flips a waiting agent into the app live.
  io()?.to(`user:${String(agent.userId)}`).emit('agent.verified', { status: agent.verificationStatus });

  res.json({ id: agent.id, verified: agent.verified, verificationStatus: agent.verificationStatus });
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
  dailyTarget: z.number().int().nonnegative().optional(),
});

// Admin-direct-create: unlike the mobile app's own registration flows (which
// require OTP-verified login before granting a role), the admin can hand a
// role straight to a phone number. That person can then log in normally via
// OTP any time after — this just pre-provisions the account + role record.
async function createUser(req, res) {
  const body = createUserSchema.parse(req.body);
  // Must match exactly what the mobile app's OTP flow looks the user up by
  // (OtpScreen.jsx always sends `+91` + 10 digits) — otherwise this person
  // can never actually log into the role just provisioned for them; OTP
  // login would silently create a second, blank User document instead of
  // matching this one.
  const phone = normalizePhone(body.phone);

  if (body.role === 'vendor' && !body.categoryId) {
    fail(400, 'CATEGORY_REQUIRED', 'Pick a category for the vendor.');
  }
  if ((body.role === 'vendor' || body.role === 'employee') && !body.area) {
    fail(400, 'AREA_REQUIRED', 'Area is required for this role.');
  }

  let user = await UserModel.findOne({ phone });
  if (!user) {
    user = await UserModel.create({ phone, name: body.name, roles: [] });
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
        dailyTarget: body.dailyTarget ?? 0,
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

  // `vendorName` on Booking is the business name only, denormalized at
  // booking time — the admin table also wants the vendor's own person name
  // (Vendor.personName, set at registration), which isn't stored on the
  // booking itself. A separate lookup (rather than .populate('vendorId'))
  // keeps `vendorId` in the response a plain id string, not a populated
  // sub-document, so nothing else reading this endpoint's shape breaks.
  const vendorIds = [...new Set(bookings.map((b) => String(b.vendorId)))];
  const vendors = await VendorModel.find({ _id: { $in: vendorIds } }, 'personName');
  const personNameById = new Map(vendors.map((v) => [String(v._id), v.personName ?? null]));

  const data = bookings.map((b) => ({
    ...b.toJSON(),
    vendorPersonName: personNameById.get(String(b.vendorId)) ?? null,
  }));
  res.json(buildPage(data, skip, limit, total));
}

module.exports = {
  adminLogin,
  adminSetup,
  adminChangePassword,
  getStats,
  listUsers,
  getUserDetail,
  updateVendorVerification,
  updateAgentVerification,
  createUser,
  listBookings,
};
