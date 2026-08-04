const { UserModel } = require('../models/User');
const { CustomerReferralModel } = require('../models/CustomerReferral');
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

async function listMyCustomerReferrals(req, res) {
  const skip = parseCursor(typeof req.query.cursor === 'string' ? req.query.cursor : undefined);
  const limit = 10;
  const [total, rows] = await Promise.all([
    CustomerReferralModel.countDocuments({ referrerId: req.user._id }),
    CustomerReferralModel.find({ referrerId: req.user._id }).sort({ createdAt: -1 }).skip(skip).limit(limit),
  ]);
  res.json(buildPage(rows.map((r) => r.toJSON()), skip, limit, total));
}

module.exports = { creditCustomerReferrer, listMyCustomerReferrals, COINS_PER_CUSTOMER_REFERRAL };
