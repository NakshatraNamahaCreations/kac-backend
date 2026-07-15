const { z } = require('zod');
const { LedgerEntryModel } = require('../models/LedgerEntry');
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

const rechargeSchema = z.object({ coins: z.number().int().positive() });

async function recharge(req, res) {
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

module.exports = { getWallet, getWalletLedger, recharge, debit, creditCustomerWelcomeBonus };
