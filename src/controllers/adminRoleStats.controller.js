const { UserModel } = require('../models/User');
const { VendorModel } = require('../models/Vendor');
const { AgentModel, effectiveAgentStatus } = require('../models/Agent');
const { EmployeeModel, EmployeeReferralModel } = require('../models/Employee');
const { BookingModel } = require('../models/Booking');
const { OnboardingModel } = require('../models/Onboarding');
const { CustomerReferralModel } = require('../models/CustomerReferral');
const { fail } = require('../lib/httpError');

// Per-role dashboard view (admin Dashboard: click a stat card). Every role
// answers the same shape so one set of charts renders all four:
//   trend     { label, points: [{ month, value }] }  — last 6 months
//   breakdown { title, subtitle, items: [{ key, label, count }] }
//   rates     [{ label, value }]                     — percentages 0-100

const pct = (part, total) => (total ? Math.round((part / total) * 100) : 0);

// Monthly counts over the last 6 months, oldest first (same windowing as
// getStats' bookings trend).
function monthlyTrend(dates) {
  const now = new Date();
  const points = [];
  for (let i = 5; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    points.push({
      month: start.toLocaleString('en-US', { month: 'short' }),
      value: dates.filter((d) => d >= start && d < end).length,
    });
  }
  return points;
}

function sixMonthsAgo() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - 5, 1);
}

async function customerStats() {
  const since = sixMonthsAgo();
  const [total, recent, bookedIds, referred, withCoins] = await Promise.all([
    UserModel.countDocuments({ roles: 'customer' }),
    UserModel.find({ roles: 'customer', createdAt: { $gte: since } }).select('createdAt'),
    BookingModel.distinct('customerId'),
    CustomerReferralModel.distinct('referredId'),
    UserModel.countDocuments({ roles: 'customer', walletCoins: { $gt: 0 } }),
  ]);
  const booked = await UserModel.countDocuments({ roles: 'customer', _id: { $in: bookedIds } });
  const referredCount = await UserModel.countDocuments({ roles: 'customer', _id: { $in: referred } });
  return {
    total,
    trend: { label: 'New customers', points: monthlyTrend(recent.map((u) => u.createdAt)) },
    breakdown: {
      title: 'Customer activity',
      subtitle: `${total} customers`,
      items: [
        { key: 'booked', label: 'Booked', count: booked },
        { key: 'notBooked', label: 'Never booked', count: Math.max(0, total - booked) },
        { key: 'referred', label: 'Referred', count: referredCount },
        { key: 'coins', label: 'Have coins', count: withCoins },
      ],
    },
    rates: [
      { label: 'Booked', value: pct(booked, total) },
      { label: 'Referred', value: pct(referredCount, total) },
      { label: 'Have coins', value: pct(withCoins, total) },
    ],
  };
}

async function vendorStats() {
  const since = sixMonthsAgo();
  const [byStatus, recent] = await Promise.all([
    VendorModel.aggregate([{ $group: { _id: '$verificationStatus', count: { $sum: 1 } } }]),
    // Vendor's creation timestamp is named joinedAt (see Vendor model).
    VendorModel.find({ joinedAt: { $gte: since } }).select('joinedAt'),
  ]);
  const s = Object.fromEntries(byStatus.map((r) => [r._id, r.count]));
  const total = byStatus.reduce((sum, r) => sum + r.count, 0);
  const active = s.ACTIVE ?? 0;
  const pending = s.PENDING_VERIFICATION ?? 0;
  const unpaid = s.PENDING_PAYMENT ?? 0;
  const suspended = s.SUSPENDED ?? 0;
  return {
    total,
    trend: { label: 'New vendors', points: monthlyTrend(recent.map((v) => v.joinedAt)) },
    breakdown: {
      title: 'Vendors by status',
      subtitle: `${total} vendors`,
      items: [
        { key: 'unpaid', label: 'Payment due', count: unpaid },
        { key: 'pending', label: 'Awaiting approval', count: pending },
        { key: 'active', label: 'Active', count: active },
        { key: 'suspended', label: 'Suspended', count: suspended },
      ],
    },
    rates: [
      { label: 'Active', value: pct(active, total) },
      { label: 'Awaiting approval', value: pct(pending + unpaid, total) },
      { label: 'Suspended', value: pct(suspended, total) },
    ],
  };
}

async function agentStats() {
  // Only people who registered as agents — vendors also get a wallet-only
  // Agent document (agent.controller.js requireOwnAgent).
  const userIds = (await UserModel.find({ roles: 'agent' }).select('_id')).map((u) => u._id);
  const [agents, onboardings] = await Promise.all([
    AgentModel.find({ userId: { $in: userIds } }).select('createdAt verificationStatus'),
    OnboardingModel.find({ agentId: { $in: userIds } }).select('status'),
  ]);
  const total = agents.length;
  const count = (status) => agents.filter((a) => effectiveAgentStatus(a) === status).length;
  const active = count('ACTIVE');
  const pending = count('PENDING_VERIFICATION');
  const suspended = count('SUSPENDED');
  const onboarded = onboardings.filter((o) => o.status === 'ACTIVE').length;
  return {
    total,
    trend: { label: 'New agents', points: monthlyTrend(agents.map((a) => a.createdAt)) },
    breakdown: {
      title: 'Agents by status',
      subtitle: `${total} agents · ${onboarded} sign-ups brought in`,
      items: [
        { key: 'pending', label: 'Awaiting approval', count: pending },
        { key: 'active', label: 'Active', count: active },
        { key: 'suspended', label: 'Suspended', count: suspended },
        { key: 'onboarded', label: 'Sign-ups brought in', count: onboarded },
      ],
    },
    rates: [
      { label: 'Active', value: pct(active, total) },
      { label: 'Awaiting approval', value: pct(pending, total) },
      { label: 'Suspended', value: pct(suspended, total) },
    ],
  };
}

async function employeeStats() {
  const since = sixMonthsAgo();
  const [total, byRole, recent] = await Promise.all([
    EmployeeModel.countDocuments(),
    EmployeeReferralModel.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]),
    EmployeeReferralModel.find({ createdAt: { $gte: since } }).select('createdAt'),
  ]);
  const r = Object.fromEntries(byRole.map((x) => [x._id, x.count]));
  const customer = r.customer ?? 0;
  const vendor = r.vendor ?? 0;
  const agent = r.agent ?? 0;
  const signups = customer + vendor + agent;
  return {
    total,
    trend: { label: 'Sign-ups via employees', points: monthlyTrend(recent.map((x) => x.createdAt)) },
    breakdown: {
      title: 'Sign-ups by role',
      subtitle: `${signups} sign-ups from ${total} employees`,
      items: [
        { key: 'customer', label: 'Customers', count: customer },
        { key: 'vendor', label: 'Vendors', count: vendor },
        { key: 'agent', label: 'Agents', count: agent },
      ],
    },
    rates: [
      { label: 'Customers', value: pct(customer, signups) },
      { label: 'Vendors', value: pct(vendor, signups) },
      { label: 'Agents', value: pct(agent, signups) },
    ],
  };
}

const BUILDERS = { customer: customerStats, vendor: vendorStats, agent: agentStats, employee: employeeStats };

async function getRoleStats(req, res) {
  const build = BUILDERS[req.params.role];
  if (!build) fail(404, 'NOT_FOUND', 'Unknown role.');
  res.json({ role: req.params.role, ...(await build()) });
}

module.exports = { getRoleStats };
