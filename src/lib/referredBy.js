const { UserModel } = require('../models/User');
const { VendorModel } = require('../models/Vendor');
const { AgentModel } = require('../models/Agent');
const { EmployeeModel, EmployeeReferralModel } = require('../models/Employee');
const { CustomerReferralModel } = require('../models/CustomerReferral');
const { VendorReferralModel } = require('../models/VendorReferral');
const { OnboardingModel } = require('../models/Onboarding');
const { customerReferralCode, vendorReferralCode } = require('./referralCode');

// Who referred this person, for the admin panel — one entry per referral
// that was actually credited, across every referral path:
//   customer code  -> CustomerReferral (referredId)
//   vendor code    -> VendorReferral (referredPhone)
//   employee code  -> EmployeeReferral (userId)
//   agent code / in-person agent onboarding -> Onboarding (vendorPhone)
// A code that matched nobody at signup left no record, so it can't show here.
// Each entry: { forRole, referrerType, referrerName, referrerPhone,
// referrerCode, via, coinsEarned, at }. forRole is the role this person
// signed up as when referred (null when the record doesn't say).
async function referredByForUser(user) {
  const userId = user._id;
  const phone = user.phone;

  const [customerRefs, vendorRefs, employeeRefs, onboardings] = await Promise.all([
    CustomerReferralModel.find({ referredId: userId }),
    phone ? VendorReferralModel.find({ referredPhone: phone }) : [],
    EmployeeReferralModel.find({ userId }),
    phone ? OnboardingModel.find({ vendorPhone: phone }) : [],
  ]);

  const [customers, vendors, employees, agentUsers, agents] = await Promise.all([
    UserModel.find({ _id: { $in: customerRefs.map((r) => r.referrerId) } }, 'name phone referralCode'),
    VendorModel.find({ _id: { $in: vendorRefs.map((r) => r.referrerVendorId) } }, 'name ownerName phone referralCode'),
    EmployeeModel.find({ _id: { $in: employeeRefs.map((r) => r.employeeId) } }, 'referralCode employeeId userId').populate(
      'userId',
      'name phone',
    ),
    UserModel.find({ _id: { $in: onboardings.map((o) => o.agentId) } }, 'name phone'),
    AgentModel.find({ userId: { $in: onboardings.map((o) => o.agentId) } }, 'userId executiveCode'),
  ]);
  const byId = (docs) => new Map(docs.map((d) => [String(d._id), d]));
  const customerById = byId(customers);
  const vendorById = byId(vendors);
  const employeeById = byId(employees);
  const agentUserById = byId(agentUsers);
  const codeByAgentUser = new Map(agents.map((a) => [String(a.userId), a.executiveCode]));

  const entries = [
    ...customerRefs.map((r) => {
      const c = customerById.get(String(r.referrerId));
      return {
        forRole: 'customer',
        referrerType: 'customer',
        referrerName: c?.name ?? null,
        referrerPhone: c?.phone ?? null,
        referrerCode: c ? c.referralCode || customerReferralCode(String(c._id)) : null,
        via: 'Referral code',
        coinsEarned: r.coinsEarned,
        at: r.createdAt,
      };
    }),
    ...vendorRefs.map((r) => {
      const v = vendorById.get(String(r.referrerVendorId));
      return {
        forRole: r.referredRole,
        referrerType: 'vendor',
        referrerName: v ? v.name || v.ownerName : null,
        referrerPhone: v?.phone ?? null,
        referrerCode: v ? v.referralCode || vendorReferralCode(String(v._id)) : null,
        via: 'Referral code',
        coinsEarned: r.coinsEarned,
        at: r.createdAt,
      };
    }),
    ...employeeRefs.map((r) => {
      const e = employeeById.get(String(r.employeeId));
      return {
        forRole: r.role,
        referrerType: 'employee',
        referrerName: e?.userId?.name ?? null,
        referrerPhone: e?.userId?.phone ?? null,
        referrerCode: e?.referralCode ?? null,
        via: e?.employeeId ? `Referral code · ${e.employeeId}` : 'Referral code',
        coinsEarned: null,
        at: r.createdAt,
      };
    }),
    ...onboardings.map((o) => {
      const a = agentUserById.get(String(o.agentId));
      // In-person onboarding carries what the agent collected (plan, area,
      // owner); a bare row is a typed agent code (creditReferralCodeForAgent).
      const inPerson = !!(o.plan || o.prepaid || o.area || o.ownerName);
      return {
        forRole: inPerson ? 'vendor' : null,
        referrerType: 'agent',
        referrerName: a?.name ?? null,
        referrerPhone: a?.phone ?? null,
        referrerCode: codeByAgentUser.get(String(o.agentId)) ?? null,
        via: inPerson ? `In-person onboarding · ${o.status.toLowerCase()}` : 'Referral code',
        coinsEarned: o.earningsCoins ?? null,
        at: o.createdAt,
      };
    }),
  ];

  return entries.sort((x, y) => new Date(y.at) - new Date(x.at));
}

module.exports = { referredByForUser };
