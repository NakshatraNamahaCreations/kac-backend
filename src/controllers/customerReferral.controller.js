const { UserModel } = require('../models/User');
const { CustomerReferralModel } = require('../models/CustomerReferral');
const { AgentModel } = require('../models/Agent');
const { creditCustomerWelcomeBonus } = require('./customerWallet.controller');
const { buildPage, parseCursor } = require('../lib/pagination');

const COINS_PER_CUSTOMER_REFERRAL = 249;

// Credits the referring customer when someone signs up using their code —
// separate from the 99-coin welcome bonus the NEW customer gets (that one's
// handled in session.controller.js's addRole). Returns false if the code
// doesn't belong to any customer (e.g. stale/mistyped) or is a self-referral.
async function creditCustomerReferrer(referralCode, referredUser) {
  const referrer = await UserModel.findOne({ referralCode: referralCode.trim().toUpperCase() });
  if (!referrer) return false;
  if (String(referrer._id) === String(referredUser._id)) return false;

  await creditCustomerWelcomeBonus(referrer, COINS_PER_CUSTOMER_REFERRAL, `Referral bonus — ${referredUser.name ?? 'a new customer'}`);
  await CustomerReferralModel.create({
    referrerId: referrer._id,
    referredId: referredUser._id,
    referredName: referredUser.name ?? 'Customer',
    referredPhone: referredUser.phone,
    coinsEarned: COINS_PER_CUSTOMER_REFERRAL,
  });
  return true;
}

// A new customer signed up with an AGENT's code (GK-AGT-…) — the agent
// earns the same 249 coins, into their agent wallet. Recorded as a
// CustomerReferral (referrerRole 'agent') so the admin panel shows who
// referred the customer. Returns false for an unknown code or self-referral.
async function creditAgentForCustomerReferral(referralCode, referredUser) {
  // Required here, not at the top: agent.controller pulls in modules that
  // load this file, and a top-level require would be a circular import.
  const { creditAgentCoins } = require('./agent.controller');
  const agent = await AgentModel.findOne({ executiveCode: referralCode.trim().toUpperCase() });
  if (!agent) return false;
  if (String(agent.userId) === String(referredUser._id)) return false;
  // Only registered agents — a vendor's wallet-only Agent doc also has a code.
  const agentUser = await UserModel.findById(agent.userId, 'roles');
  if (!agentUser?.roles?.includes('agent')) return false;

  const name = referredUser.name ?? 'a new customer';
  await creditAgentCoins(agent.userId, 'Customer referral bonus', name, null, COINS_PER_CUSTOMER_REFERRAL);
  await CustomerReferralModel.create({
    referrerId: agent.userId,
    referredId: referredUser._id,
    referredName: referredUser.name ?? 'Customer',
    referredPhone: referredUser.phone,
    coinsEarned: COINS_PER_CUSTOMER_REFERRAL,
    referrerRole: 'agent',
  });
  return true;
}

// The customer app's own "people I referred" list — customer-code
// referrals only (agent-code ones belong to the agent wallet).
async function listMyCustomerReferrals(req, res) {
  const skip = parseCursor(typeof req.query.cursor === 'string' ? req.query.cursor : undefined);
  const limit = 10;
  const [total, rows] = await Promise.all([
    CustomerReferralModel.countDocuments({ referrerId: req.user._id, referrerRole: { $ne: 'agent' } }),
    CustomerReferralModel.find({ referrerId: req.user._id, referrerRole: { $ne: 'agent' } }).sort({ createdAt: -1 }).skip(skip).limit(limit),
  ]);
  res.json(buildPage(rows.map((r) => r.toJSON()), skip, limit, total));
}

module.exports = {
  creditCustomerReferrer,
  creditAgentForCustomerReferral,
  listMyCustomerReferrals,
  COINS_PER_CUSTOMER_REFERRAL,
};
