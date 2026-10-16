const { Types } = require('mongoose');
const { UserModel } = require('../models/User');
const { VendorModel } = require('../models/Vendor');
const { AgentModel } = require('../models/Agent');
const { EmployeeModel, EmployeeReferralModel } = require('../models/Employee');
const { VendorReferralModel } = require('../models/VendorReferral');
const { OnboardingModel } = require('../models/Onboarding');

// "Who referred this registration" for the admin Payments report, from the
// referral records written at signup:
//   employee code -> EmployeeReferral (userId, role)
//   vendor code   -> VendorReferral (referredPhone, referredRole)
//   agent code / in-person onboarding -> Onboarding (vendorPhone, agentId)
// Vendor registration = VENDOR_REGISTRATION (vendor paid) or
// VENDOR_ONBOARDING (agent paid in person — always agent-referred).
// Agent registration = AGENT_MEMBERSHIP.

// filter value -> [referrer, registered role]
const SOURCES = {
  'emp-ven': ['employee', 'vendor'],
  'emp-age': ['employee', 'agent'],
  'ven-ven': ['vendor', 'vendor'],
  'ven-age': ['vendor', 'agent'],
  'age-ven': ['agent', 'vendor'],
  'age-age': ['agent', 'agent'],
  'cus-coin': null,
};

async function userIdsByPhones(phones) {
  if (phones.length === 0) return [];
  return (await UserModel.find({ phone: { $in: phones } }, '_id')).map((u) => u._id);
}

// Mongo filter fragment for one source value, or null for an unknown value.
async function sourceFilter(source) {
  if (!(source in SOURCES)) return null;
  if (source === 'cus-coin') return { purpose: 'CUSTOMER_RECHARGE' };

  const [referrer, role] = SOURCES[source];
  const purpose = role === 'vendor' ? 'VENDOR_REGISTRATION' : 'AGENT_MEMBERSHIP';
  // Someone can have more than one referral record; each registration is
  // credited to ONE source, same priority as the row label
  // (referralByPayment): employee, then vendor, then agent.
  const empIds = (await EmployeeReferralModel.find({ role }, 'userId')).map((r) => String(r.userId));
  const venPhones = (await VendorReferralModel.find({ referredRole: role }, 'referredPhone')).map((r) => r.referredPhone);
  const venIds = (await userIdsByPhones(venPhones)).map(String);
  let userIds;
  if (referrer === 'employee') {
    userIds = empIds;
  } else if (referrer === 'vendor') {
    userIds = venIds.filter((id) => !empIds.includes(id));
  } else {
    const obPhones = (await OnboardingModel.find({}, 'vendorPhone')).map((o) => o.vendorPhone);
    const agentIds = (await userIdsByPhones(obPhones)).map(String);
    userIds = agentIds.filter((id) => !empIds.includes(id) && !venIds.includes(id));
  }
  const byPayer = { purpose, userId: { $in: userIds.map((id) => new Types.ObjectId(id)) } };
  // An agent paying a vendor's fee in person is itself an agent->vendor registration.
  return source === 'age-ven' ? { $or: [byPayer, { purpose: 'VENDOR_ONBOARDING' }] } : byPayer;
}

// For a page of payments: payment id -> { type, name, code } of whoever
// referred that registration (only registration payments get one).
async function referralByPayment(payments, userById) {
  const regs = payments.filter((p) =>
    ['VENDOR_REGISTRATION', 'AGENT_MEMBERSHIP', 'VENDOR_ONBOARDING'].includes(p.purpose),
  );
  if (regs.length === 0) return new Map();
  const ids = regs.map((p) => p.userId);
  const phones = regs.map((p) => userById.get(String(p.userId))?.phone).filter(Boolean);

  const [empRefs, venRefs, onboardings] = await Promise.all([
    EmployeeReferralModel.find({ userId: { $in: ids } }, 'userId role employeeId'),
    VendorReferralModel.find({ referredPhone: { $in: phones } }, 'referredPhone referredRole referrerVendorId'),
    OnboardingModel.find({ vendorPhone: { $in: phones } }, 'vendorPhone agentId'),
  ]);
  const [employees, vendors, agents] = await Promise.all([
    EmployeeModel.find({ _id: { $in: empRefs.map((r) => r.employeeId) } }, 'referralCode userId').populate('userId', 'name'),
    VendorModel.find({ _id: { $in: venRefs.map((r) => r.referrerVendorId) } }, 'name referralCode'),
    AgentModel.find({ userId: { $in: onboardings.map((o) => o.agentId) } }, 'userId executiveCode').populate('userId', 'name'),
  ]);
  const empById = new Map(employees.map((e) => [String(e._id), e]));
  const venById = new Map(vendors.map((v) => [String(v._id), v]));
  const agentByUser = new Map(agents.map((a) => [String(a.userId?._id ?? a.userId), a]));

  const out = new Map();
  for (const p of regs) {
    const role = p.purpose === 'AGENT_MEMBERSHIP' ? 'agent' : 'vendor';
    if (p.purpose === 'VENDOR_ONBOARDING') {
      const payer = userById.get(String(p.userId));
      const a = agentByUser.get(String(p.userId));
      out.set(String(p._id), { type: 'agent', name: payer?.name ?? null, code: a?.executiveCode ?? null });
      continue;
    }
    const phone = userById.get(String(p.userId))?.phone;
    const emp = empRefs.find((r) => String(r.userId) === String(p.userId) && r.role === role);
    if (emp) {
      const e = empById.get(String(emp.employeeId));
      out.set(String(p._id), { type: 'employee', name: e?.userId?.name ?? null, code: e?.referralCode ?? null });
      continue;
    }
    const ven = venRefs.find((r) => r.referredPhone === phone && r.referredRole === role);
    if (ven) {
      const v = venById.get(String(ven.referrerVendorId));
      out.set(String(p._id), { type: 'vendor', name: v?.name ?? null, code: v?.referralCode ?? null });
      continue;
    }
    const ob = onboardings.find((o) => o.vendorPhone === phone);
    if (ob) {
      const a = agentByUser.get(String(ob.agentId));
      out.set(String(p._id), { type: 'agent', name: a?.userId?.name ?? null, code: a?.executiveCode ?? null });
    }
  }
  return out;
}

module.exports = { SOURCES, sourceFilter, referralByPayment };
