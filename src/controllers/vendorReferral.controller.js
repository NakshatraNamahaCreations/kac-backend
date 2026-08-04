const { VendorModel } = require('../models/Vendor');
const { VendorReferralModel } = require('../models/VendorReferral');
const { creditAgentCoins } = require('./agent.controller');
const { buildPage, parseCursor } = require('../lib/pagination');

const COINS_PER_VENDOR_REFERRAL = 249;

// A vendor referred someone (customer/vendor/agent) using their code. Wallet
// balance for a vendor lives on the Agent document regardless of their role
// (WalletScreen.jsx reuses the agent-scoped /wallet endpoint for vendors
// too), so this reuses the exact same credit path as an agent referral.
async function creditVendorReferrer(referralCode, referredUserId, referredName, referredPhone, referredRole) {
  const vendor = await VendorModel.findOne({ referralCode: referralCode.trim().toUpperCase() });
  if (!vendor) return false;
  if (referredUserId && String(vendor.userId) === String(referredUserId)) return false;

  await creditAgentCoins(vendor.userId, 'Referral bonus', referredName, null);
  await VendorReferralModel.create({
    referrerVendorId: vendor._id,
    referredName,
    referredPhone,
    referredRole,
    coinsEarned: COINS_PER_VENDOR_REFERRAL,
  });
  return true;
}

async function listMyVendorReferrals(req, res) {
  const vendor = await VendorModel.findOne({ userId: req.user._id });
  const skip = parseCursor(typeof req.query.cursor === 'string' ? req.query.cursor : undefined);
  const limit = 10;
  if (!vendor) {
    res.json(buildPage([], skip, limit, 0));
    return;
  }
  const [total, rows] = await Promise.all([
    VendorReferralModel.countDocuments({ referrerVendorId: vendor._id }),
    VendorReferralModel.find({ referrerVendorId: vendor._id }).sort({ createdAt: -1 }).skip(skip).limit(limit),
  ]);
  res.json(buildPage(rows.map((r) => r.toJSON()), skip, limit, total));
}

module.exports = { creditVendorReferrer, listMyVendorReferrals, COINS_PER_VENDOR_REFERRAL };
