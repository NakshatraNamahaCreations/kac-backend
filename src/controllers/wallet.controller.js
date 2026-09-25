const { z } = require('zod');
const { AgentModel } = require('../models/Agent');
const { LedgerEntryModel } = require('../models/LedgerEntry');
const { fail } = require('../lib/httpError');
const { buildPage, parseCursor } = require('../lib/pagination');
const { agentReferralCode } = require('../lib/referralCode');
const { razorpayConfigured } = require('../lib/razorpay');

// Wallet balance lives on the Agent document regardless of role — agents AND
// vendors both hit these endpoints (requireRole('agent', 'vendor')) since a
// vendor has no separate wallet balance field of their own. Auto-provision
// an empty agent wallet on first touch so a signed-in agent/vendor never
// 404s here.
async function requireOwnAgent(userId) {
  let agent = await AgentModel.findOne({ userId });
  if (!agent) {
    agent = await AgentModel.create({ userId, executiveCode: agentReferralCode(String(userId)), bankAccounts: [], walletCoins: 0 });
  }
  return agent;
}

async function getWallet(req, res) {
  const agent = await requireOwnAgent(req.user._id);
  const [total, ledger] = await Promise.all([
    LedgerEntryModel.countDocuments({ ownerId: req.user._id }),
    LedgerEntryModel.find({ ownerId: req.user._id }).sort({ createdAt: -1 }).limit(10),
  ]);
  res.json({
    wallet: { coins: agent.walletCoins, bankAccounts: agent.bankAccounts.map((b) => b.toJSON()) },
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

const addBankSchema = z.object({ accountHolder: z.string(), accountNumber: z.string(), ifsc: z.string() });

async function addBankAccount(req, res) {
  const body = addBankSchema.parse(req.body);
  const digits = body.accountNumber.replace(/\D+/g, '');
  if (!body.accountHolder.trim() || digits.length < 9 || digits.length > 18) {
    fail(400, 'INVALID_BANK', 'Invalid bank account details.');
  }
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(body.ifsc.toUpperCase())) {
    fail(400, 'INVALID_IFSC', 'IFSC code is invalid.');
  }
  const agent = await requireOwnAgent(req.user._id);
  agent.bankAccounts.push({
    accountHolder: body.accountHolder.trim(),
    accountNumberMasked: `XXXX${digits.slice(-4)}`,
    ifsc: body.ifsc.toUpperCase(),
  });
  await agent.save();
  const created = agent.bankAccounts[agent.bankAccounts.length - 1];
  res.status(201).json({ bankAccount: created.toJSON() });
}

const withdrawSchema = z.object({ amountCoins: z.number().positive(), bankId: z.string() });

async function withdraw(req, res) {
  const body = withdrawSchema.parse(req.body);
  const agent = await requireOwnAgent(req.user._id);
  if (!agent.bankAccounts.id(body.bankId)) fail(404, 'BANK_NOT_FOUND', 'Bank account not found.');
  if (body.amountCoins <= 0 || body.amountCoins > agent.walletCoins) {
    fail(400, 'INVALID_AMOUNT', 'Withdrawal amount is invalid.');
  }
  agent.walletCoins -= body.amountCoins;
  await agent.save();

  const entry = await LedgerEntryModel.create({
    ownerId: req.user._id,
    kind: 'debit',
    coins: body.amountCoins,
    balance: agent.walletCoins,
    description: 'Withdrawal request',
  });
  entry.withdrawalId = String(entry._id);
  await entry.save();

  res.status(201).json({ withdrawalId: entry.withdrawalId, status: 'REQUESTED' });
}

// Credits a verified Razorpay wallet-recharge payment (called from
// payments.controller.js's verifyPayment once the signature checks out) —
// returns the new balance.
async function creditWalletCoins(userId, coins, description) {
  const agent = await requireOwnAgent(userId);
  agent.walletCoins += coins;
  await agent.save();
  await LedgerEntryModel.create({
    ownerId: userId,
    kind: 'credit',
    coins,
    balance: agent.walletCoins,
    description,
  });
  return agent.walletCoins;
}

const rechargeSchema = z.object({ coins: z.number().int().positive() });

// Demo-only instant credit, used ONLY when no Razorpay keys are configured
// (mock mode). With real keys the app recharges through
// POST /payments/wallet-order + /payments/verify (payments.controller.js),
// which credits the wallet only after the payment signature verifies — this
// endpoint would otherwise let any signed-in user mint free coins.
async function recharge(req, res) {
  if (razorpayConfigured) {
    fail(400, 'USE_PAYMENT_FLOW', 'Wallet recharge requires a payment. Use the Razorpay checkout.');
  }
  const { coins } = rechargeSchema.parse(req.body);
  const agent = await requireOwnAgent(req.user._id);
  agent.walletCoins += coins;
  await agent.save();

  await LedgerEntryModel.create({
    ownerId: req.user._id,
    kind: 'credit',
    coins,
    balance: agent.walletCoins,
    description: 'Wallet recharge',
  });

  res.status(201).json({ wallet: { coins: agent.walletCoins, bankAccounts: agent.bankAccounts.map((b) => b.toJSON()) } });
}

module.exports = {
  getWallet,
  getWalletLedger,
  addBankAccount,
  withdraw,
  recharge,
  creditWalletCoins,
};
