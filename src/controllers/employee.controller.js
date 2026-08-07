const { z } = require('zod');
const { EmployeeModel, EmployeeReferralModel, EmployeeVerificationSeedModel } = require('../models/Employee');
const { fail } = require('../lib/httpError');
const { buildPage, parseCursor } = require('../lib/pagination');
const { resolveDateRange } = require('../lib/dateRange');

const verifyCodeSchema = z.object({ code: z.string() });

// Source of truth is the Employee collection itself, not seed.used —
// earlier registrations (before this flag started being set on success)
// never got it retroactively flipped, so trusting the flag alone would
// still let a second person crash into the ones that predate this fix.
// Checking by employeeId directly is self-healing regardless of that
// flag's history.
async function seedClaimant(seed) {
  return EmployeeModel.findOne({ employeeId: seed.employeeId }).select('userId');
}

async function verifyEmployeeCode(req, res) {
  const { code } = verifyCodeSchema.parse(req.body);
  const seed = await EmployeeVerificationSeedModel.findOne({ code: code.trim().toUpperCase() });
  if (!seed) fail(400, 'INVALID_EMPLOYEE_CODE', 'That verification code is not valid. Check with HR and try again.');
  const claimant = await seedClaimant(seed);
  if (claimant && String(claimant.userId) !== String(req.user._id)) {
    fail(409, 'CODE_ALREADY_USED', 'This verification code has already been used. Contact HR for a new one.');
  }
  res.json({ code: seed.code, areaAssigned: seed.areaAssigned, suggestedName: seed.suggestedName });
}

async function registerEmployee(req, res) {
  const { code } = verifyCodeSchema.parse(req.body);
  const seed = await EmployeeVerificationSeedModel.findOne({ code: code.trim().toUpperCase() });
  if (!seed) fail(400, 'INVALID_EMPLOYEE_CODE', 'That verification code is not valid.');

  const user = req.user;
  let employee = await EmployeeModel.findOne({ userId: user._id });
  if (!employee) {
    // Without this check, a second person entering an already-claimed code
    // would sail past verify-code (it doesn't check for this either — fixed
    // above) and only fail here, on Mongoose's unique index for
    // employeeId/referralCode — an uncaught duplicate-key error, surfaced
    // to the client as an opaque 500 instead of a real error message.
    const claimant = await seedClaimant(seed);
    if (claimant) {
      fail(409, 'CODE_ALREADY_USED', 'This verification code has already been used. Contact HR for a new one.');
    }
    try {
      employee = await EmployeeModel.create({
        userId: user._id,
        employeeId: seed.employeeId,
        // Matches the mock's buildReferralCode: strip the "EMP-" prefix and
        // reuse the seed's own short numeric id (e.g. "EMP-1001" ->
        // "GK-EMP-1001"), not a hash/padded derivation — HR-issued ids stay
        // human-readable on printed ID cards.
        referralCode: `GK-EMP-${seed.employeeId.replace(/^EMP-/, '')}`,
        areaAssigned: seed.areaAssigned,
      });
    } catch (err) {
      // Race backstop: two requests for the same fresh code arriving
      // concurrently can both pass the claimant check above before either
      // finishes creating — the unique index is the real guarantee here,
      // so translate its failure into the same clean error rather than a 500.
      if (err.code === 11000) {
        fail(409, 'CODE_ALREADY_USED', 'This verification code has already been used. Contact HR for a new one.');
      }
      throw err;
    }
    if (!seed.used) {
      seed.used = true;
      await seed.save();
    }
  }
  if (!user.roles.includes('employee')) {
    user.roles.push('employee');
    await user.save();
  }

  res.status(201).json({ employeeId: employee.employeeId, referralCode: employee.referralCode, areaAssigned: employee.areaAssigned });
}

async function requireOwnEmployee(userId) {
  const employee = await EmployeeModel.findOne({ userId });
  if (!employee) fail(404, 'EMPLOYEE_NOT_FOUND', 'You have not registered as an employee yet.');
  return employee;
}

const ROLES = ['customer', 'vendor', 'agent'];

function emptyBreakdown() {
  return { customer: 0, vendor: 0, agent: 0, total: 0 };
}

async function getEmployeeDashboard(req, res) {
  const employee = await requireOwnEmployee(req.user._id);
  const referrals = await EmployeeReferralModel.find({ employeeId: employee._id });

  const totals = emptyBreakdown();
  referrals.forEach((r) => {
    totals[r.role] += 1;
    totals.total += 1;
  });

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todays = referrals.filter((r) => r.createdAt >= todayStart);
  const todayBreakdown = emptyBreakdown();
  todays.forEach((r) => {
    todayBreakdown[r.role] += 1;
    todayBreakdown.total += 1;
  });

  const now = new Date();
  const monthly = [];
  for (let i = 5; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    const count = referrals.filter((r) => r.createdAt >= start && r.createdAt < end).length;
    monthly.push({ month: start.toLocaleString('en-US', { month: 'short' }), downloads: count, registrations: count });
  }

  res.json({
    profile: { employeeId: employee.employeeId, referralCode: employee.referralCode, areaAssigned: employee.areaAssigned },
    totals: {
      downloads: totals.total,
      registrations: totals.total,
      customerRegistrations: totals.customer,
      vendorRegistrations: totals.vendor,
      agentRegistrations: totals.agent,
    },
    today: {
      downloads: todayBreakdown.total,
      registrations: todayBreakdown.total,
      customerRegistrations: todayBreakdown.customer,
      vendorRegistrations: todayBreakdown.vendor,
      agentRegistrations: todayBreakdown.agent,
      customerDownloads: todayBreakdown.customer,
      vendorDownloads: todayBreakdown.vendor,
      agentDownloads: todayBreakdown.agent,
      target: employee.dailyTarget,
    },
    monthly,
  });
}

const PRESETS = ['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'custom', 'all_time'];

async function getEmployeeStats(req, res) {
  const employee = await requireOwnEmployee(req.user._id);
  const presetParam = typeof req.query.preset === 'string' ? req.query.preset : 'all_time';
  const preset = PRESETS.includes(presetParam) ? presetParam : 'all_time';
  const from = typeof req.query.from === 'string' ? req.query.from : undefined;
  const to = typeof req.query.to === 'string' ? req.query.to : undefined;
  const range = resolveDateRange(preset, from, to);

  const referrals = await EmployeeReferralModel.find({
    employeeId: employee._id,
    createdAt: { $gte: range.from, $lt: range.to },
  });

  const breakdown = emptyBreakdown();
  referrals.forEach((r) => {
    breakdown[r.role] += 1;
    breakdown.total += 1;
  });

  res.json({
    range: { preset: range.preset, from: range.from.toISOString(), to: range.to.toISOString(), label: range.label },
    downloads: breakdown,
    registrations: breakdown,
    ...(preset === 'today' ? { target: employee.dailyTarget } : {}),
  });
}

async function listEmployeeReferralUsers(req, res) {
  const employee = await requireOwnEmployee(req.user._id);
  const role = typeof req.query.role === 'string' ? req.query.role : undefined;
  const presetParam = typeof req.query.preset === 'string' ? req.query.preset : undefined;
  const from = typeof req.query.from === 'string' ? req.query.from : undefined;
  const to = typeof req.query.to === 'string' ? req.query.to : undefined;
  const skip = parseCursor(typeof req.query.cursor === 'string' ? req.query.cursor : undefined);
  const limit = 15;

  const filter = { employeeId: employee._id };
  if (role && ROLES.includes(role)) filter.role = role;
  if (presetParam && PRESETS.includes(presetParam)) {
    const range = resolveDateRange(presetParam, from, to);
    filter.createdAt = { $gte: range.from, $lt: range.to };
  }

  const [total, rows] = await Promise.all([
    EmployeeReferralModel.countDocuments(filter),
    EmployeeReferralModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
  ]);

  const data = rows.map((r) => ({
    id: String(r._id),
    name: r.userName,
    phone: r.userPhone,
    role: r.role,
    registeredAt: r.createdAt.toISOString(),
    status: r.status,
    area: r.area,
  }));

  res.json(buildPage(data, skip, limit, total));
}

module.exports = {
  verifyEmployeeCode,
  registerEmployee,
  getEmployeeDashboard,
  getEmployeeStats,
  listEmployeeReferralUsers,
};
