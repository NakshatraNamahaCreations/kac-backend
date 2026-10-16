const { z } = require('zod');
const { AgentModel } = require('../models/Agent');
const { VendorModel } = require('../models/Vendor');
const { LedgerEntryModel } = require('../models/LedgerEntry');
const { WithdrawalModel } = require('../models/Withdrawal');
const { fail } = require('../lib/httpError');
const { buildPage, parseCursor } = require('../lib/pagination');
const { agentReferralCode } = require('../lib/referralCode');
const { razorpayConfigured } = require('../lib/razorpay');
const { accountFields } = require('../lib/aadhaarVault');

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

// A vendor's payout bank is saved on their vendor profile (Vendor.bank, set
// at registration / Edit profile), not in the wallet's bankAccounts — so the
// Withdraw screen had no account to pick. Mirror it into the wallet: add it
// when missing, keep it up to date when the vendor changes it.
async function syncVendorBank(agent, userId) {
  const vendor = await VendorModel.findOne({ userId }, 'bank');
  const vb = vendor?.bank;
  if (!vb?.accountNumberMasked || !vb.ifsc || !vb.accountHolder) return;
  const existing = agent.bankAccounts.find((b) => b.fromVendorProfile);
  const fields = {
    accountHolder: vb.accountHolder,
    accountNumberMasked: vb.accountNumberMasked,
    accountNumberEnc: vb.accountNumberEnc ?? null,
    ifsc: vb.ifsc,
  };
  if (existing) {
    const same = Object.entries(fields).every(([k, v]) => (existing[k] ?? null) === v);
    if (same) return;
    Object.assign(existing, fields);
  } else {
    // Same account already added by hand in the wallet — don't duplicate it.
    const dup = agent.bankAccounts.find(
      (b) => b.ifsc === vb.ifsc && b.accountNumberMasked === vb.accountNumberMasked,
    );
    if (dup) return;
    agent.bankAccounts.unshift({ ...fields, fromVendorProfile: true });
  }
  await agent.save();
}

async function getWallet(req, res) {
  const agent = await requireOwnAgent(req.user._id);
  await syncVendorBank(agent, req.user._id);
  const [total, ledger] = await Promise.all([
    LedgerEntryModel.countDocuments({ ownerId: req.user._id, pool: { $ne: 'customer' } }),
    LedgerEntryModel.find({ ownerId: req.user._id, pool: { $ne: 'customer' } }).sort({ createdAt: -1 }).limit(10),
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
    LedgerEntryModel.countDocuments({ ownerId: req.user._id, pool: { $ne: 'customer' } }),
    LedgerEntryModel.find({ ownerId: req.user._id, pool: { $ne: 'customer' } }).sort({ createdAt: -1 }).skip(skip).limit(limit),
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
    ...accountFields(digits),
    ifsc: body.ifsc.toUpperCase(),
  });
  await agent.save();
  const created = agent.bankAccounts[agent.bankAccounts.length - 1];
  res.status(201).json({ bankAccount: created.toJSON() });
}

const withdrawSchema = z.object({ amountCoins: z.number().int().positive(), bankId: z.string() });

// Same limits the app shows (src/lib/money.js): ₹250 always stays in the
// wallet, and one withdrawal is at least ₹250.
const WALLET_RESERVE_COINS = 250;
const WITHDRAW_MIN_COINS = 250;

// Payouts are manual (admin panel > Withdrawals): the coins are held here,
// then an admin transfers the money and marks it paid, or rejects it and
// the coins come back (adminWithdrawals.controller.js).
async function withdraw(req, res) {
  const body = withdrawSchema.parse(req.body);
  const agent = await requireOwnAgent(req.user._id);
  await syncVendorBank(agent, req.user._id);
  const bank = agent.bankAccounts.id(body.bankId);
  if (!bank) fail(404, 'BANK_NOT_FOUND', 'Bank account not found.');
  if (body.amountCoins < WITHDRAW_MIN_COINS) {
    fail(400, 'INVALID_AMOUNT', `The minimum withdrawal is ₹${WITHDRAW_MIN_COINS}.`);
  }
  if (body.amountCoins > agent.walletCoins - WALLET_RESERVE_COINS) {
    fail(400, 'INVALID_AMOUNT', `₹${WALLET_RESERVE_COINS} must stay in your wallet. Enter a smaller amount.`);
  }
  agent.walletCoins -= body.amountCoins;
  await agent.save();

  const withdrawal = await WithdrawalModel.create({
    userId: req.user._id,
    amountCoins: body.amountCoins,
    upiNumber: req.user.upiNumber ?? null,
    bank: {
      accountHolder: bank.accountHolder,
      accountNumberMasked: bank.accountNumberMasked,
      accountNumberEnc: bank.accountNumberEnc ?? null,
      ifsc: bank.ifsc,
    },
  });
  const entry = await LedgerEntryModel.create({
    pool: 'agent',
    ownerId: req.user._id,
    kind: 'debit',
    coins: body.amountCoins,
    balance: agent.walletCoins,
    description: 'Withdrawal requested · awaiting admin payout',
    withdrawalId: String(withdrawal._id),
  });
  withdrawal.ledgerEntryId = entry._id;
  await withdrawal.save();

  res.status(201).json({ withdrawalId: String(withdrawal._id), status: 'REQUESTED' });
}

// The signed-in vendor / agent's own withdrawals, newest first, so the app
// can show whether each one is still pending, paid (with the bank ref) or
// rejected (with the reason).
async function listMyWithdrawals(req, res) {
  const rows = await WithdrawalModel.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(50);
  res.json({ data: rows.map((w) => w.toJSON()) });
}

// Credits a verified Razorpay wallet-recharge payment (called from
// payments.controller.js's verifyPayment once the signature checks out) —
// returns the new balance.
async function creditWalletCoins(userId, coins, description) {
  const agent = await requireOwnAgent(userId);
  agent.walletCoins += coins;
  await agent.save();
  await LedgerEntryModel.create({
    pool: 'agent',
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
    pool: 'agent',
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
  listMyWithdrawals,
  withdraw,
  recharge,
  creditWalletCoins,
};
