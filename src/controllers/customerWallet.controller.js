const { z } = require('zod');
const { LedgerEntryModel } = require('../models/LedgerEntry');
const { UserModel } = require('../models/User');
const { razorpayConfigured } = require('../lib/razorpay');
const { fail } = require('../lib/httpError');
const { buildPage, parseCursor } = require('../lib/pagination');

// Customer wallet lives directly on User.walletCoins (unlike agent/vendor,
// there's no separate profile document for the customer role) — coins gate
// the "call vendor" action and are earned via referral welcome bonuses or
// bought via Recharge.

async function getWallet(req, res) {
  const [total, ledger] = await Promise.all([
    LedgerEntryModel.countDocuments({ ownerId: req.user._id }),
    LedgerEntryModel.find({ ownerId: req.user._id }).sort({ createdAt: -1 }).limit(10),
  ]);
  res.json({
    wallet: { coins: req.user.walletCoins },
    ledger: buildPage(ledger.map((l) => l.toJSON()), 0, 10, total),
  });
}

async function getWalletLedger(req, res) {
  const skip = parseCursor(typeof req.query.cursor === 'string' ? req.query.cursor : undefined);
  const limit = 10;
  const [total, ledger] = await Promise.all([
    LedgerEntryModel.countDocuments({ ownerId: req.user._id }),
    LedgerEntryModel.find({ ownerId: req.user._id }).sort({ createdAt: -1 }).skip(skip).limit(limit),
  ]);
  res.json(buildPage(ledger.map((l) => l.toJSON()), skip, limit, total));
}

// Credits a verified Razorpay recharge (called from payments.controller.js's
// verifyPayment once the signature checks out) — returns the new balance.
async function creditCustomerCoins(userId, coins, description) {
  const user = await UserModel.findById(userId);
  user.walletCoins += coins;
  await user.save();
  await LedgerEntryModel.create({
    ownerId: user._id,
    kind: 'credit',
    coins,
    balance: user.walletCoins,
    description,
  });
  return user.walletCoins;
}

const rechargeSchema = z.object({ coins: z.number().int().positive() });

// Demo-only instant credit, used ONLY when no Razorpay keys are configured
// (mock mode). With real keys the app recharges through
// POST /payments/customer-wallet-order + /payments/verify, which credits
// coins only after the payment signature verifies.
async function recharge(req, res) {
  if (razorpayConfigured) {
    fail(400, 'USE_PAYMENT_FLOW', 'Wallet recharge requires a payment. Use the Razorpay checkout.');
  }
  const { coins } = rechargeSchema.parse(req.body);
  const user = req.user;
  user.walletCoins += coins;
  await user.save();

  const entry = await LedgerEntryModel.create({
    ownerId: user._id,
    kind: 'credit',
    coins,
    balance: user.walletCoins,
    description: 'Wallet recharge',
  });

  res.status(201).json({ wallet: { coins: user.walletCoins }, entry: entry.toJSON() });
}

const debitSchema = z.object({ coins: z.number().int().positive(), description: z.string() });

async function debit(req, res) {
  const body = debitSchema.parse(req.body);
  const user = req.user;
  if (user.walletCoins < body.coins) {
    fail(402, 'INSUFFICIENT_COINS', 'Not enough coins for this action.');
  }
  user.walletCoins -= body.coins;
  await user.save();

  const entry = await LedgerEntryModel.create({
    ownerId: user._id,
    kind: 'debit',
    coins: body.coins,
    balance: user.walletCoins,
    description: body.description,
  });

  res.status(201).json({ wallet: { coins: user.walletCoins }, entry: entry.toJSON() });
}

// Credits the customer referral welcome bonus — called from session.controller's
// patchMe on first-time profile setup when a 'customer'-kind code was entered.
async function creditCustomerWelcomeBonus(user, coins, description) {
  user.walletCoins += coins;
  await user.save();
  await LedgerEntryModel.create({
    ownerId: user._id,
    kind: 'credit',
    coins,
    balance: user.walletCoins,
    description,
  });
}

module.exports = {
  getWallet,
  getWalletLedger,
  recharge,
  debit,
  creditCustomerWelcomeBonus,
  creditCustomerCoins,
};
