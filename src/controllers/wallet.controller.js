const { z } = require('zod');
const { AgentModel } = require('../models/Agent');
const { LedgerEntryModel } = require('../models/LedgerEntry');
const { fail } = require('../lib/httpError');
const { buildPage, parseCursor } = require('../lib/pagination');
const { agentReferralCode } = require('../lib/referralCode');

// Wallet is agent-scoped in the current contract (see endpoints.wallet.* —
// only /wallet, tied to the agent dashboard/wallet screens). Auto-provision
// an empty agent wallet on first touch so a signed-in agent never 404s here.
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

module.exports = {
  getWallet,
  getWalletLedger,
  addBankAccount,
  withdraw,
};
