const { z } = require('zod');
const { isValidObjectId } = require('mongoose');
const { WithdrawalModel } = require('../models/Withdrawal');
const { UserModel } = require('../models/User');
const { LedgerEntryModel } = require('../models/LedgerEntry');
const { fail } = require('../lib/httpError');
const { buildPage, parseCursor } = require('../lib/pagination');
const { decryptSecret } = require('../lib/aadhaarVault');
const { creditWalletCoins } = require('./wallet.controller');
const { io } = require('../realtime/socket');

const PAGE_LIMIT = 25;
const STATUSES = ['REQUESTED', 'PAID', 'REJECTED'];

// Admin view of a withdrawal: who asked, and the FULL account number so the
// admin can make the bank transfer by hand.
async function enrich(rows) {
  const users = await UserModel.find({ _id: { $in: rows.map((w) => w.userId) } }, 'name phone roles upiNumber');
  const userById = new Map(users.map((u) => [String(u._id), u]));
  return rows.map((w) => {
    const u = userById.get(String(w.userId));
    return {
      ...w.toJSON(),
      userId: String(w.userId),
      user: u ? { name: u.name, phone: u.phone, roles: u.roles } : null,
      // Snapshot from the request; falls back to the user's current number.
      upiNumber: w.upiNumber ?? u?.upiNumber ?? null,
      bank: { ...w.toJSON().bank, accountNumber: decryptSecret(w.bank?.accountNumberEnc) },
    };
  });
}

async function listWithdrawals(req, res) {
  const status = typeof req.query.status === 'string' && STATUSES.includes(req.query.status) ? req.query.status : null;
  const filter = status ? { status } : {};
  const skip = parseCursor(typeof req.query.cursor === 'string' ? req.query.cursor : undefined);
  const [total, rows, pending] = await Promise.all([
    WithdrawalModel.countDocuments(filter),
    WithdrawalModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(PAGE_LIMIT),
    WithdrawalModel.aggregate([
      { $match: { status: 'REQUESTED' } },
      { $group: { _id: null, count: { $sum: 1 }, coins: { $sum: '$amountCoins' } } },
    ]),
  ]);
  const page = buildPage(await enrich(rows), skip, PAGE_LIMIT, total);
  res.json({
    ...page,
    total,
    pending: { count: pending[0]?.count ?? 0, coins: pending[0]?.coins ?? 0 },
  });
}

const resolveSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('pay'),
    payoutReference: z.string().trim().min(3, 'Enter the bank reference (UTR).').max(60),
    note: z.string().trim().max(300).optional(),
  }),
  z.object({
    action: z.literal('reject'),
    note: z.string().trim().min(3, 'Give a reason so the user knows why.').max(300),
  }),
]);

// Mark a REQUESTED withdrawal paid (admin already transferred the money) or
// rejected (held coins go back to the wallet). The status guard in the
// update makes a double click / two admins unable to pay or refund twice.
async function resolveWithdrawal(req, res) {
  if (!isValidObjectId(req.params.id)) fail(404, 'NOT_FOUND', 'Withdrawal not found.');
  const body = resolveSchema.parse(req.body);
  const status = body.action === 'pay' ? 'PAID' : 'REJECTED';

  const w = await WithdrawalModel.findOneAndUpdate(
    { _id: req.params.id, status: 'REQUESTED' },
    {
      $set: {
        status,
        payoutReference: body.action === 'pay' ? body.payoutReference : null,
        adminNote: body.note || null,
        resolvedAt: new Date(),
      },
    },
    { new: true },
  );
  if (!w) {
    const exists = await WithdrawalModel.exists({ _id: req.params.id });
    fail(exists ? 409 : 404, exists ? 'ALREADY_RESOLVED' : 'NOT_FOUND', exists ? 'This withdrawal was already processed.' : 'Withdrawal not found.');
  }

  if (status === 'PAID') {
    if (w.ledgerEntryId) {
      await LedgerEntryModel.updateOne(
        { _id: w.ledgerEntryId },
        { $set: { description: `Withdrawal paid to bank · Ref ${w.payoutReference}` } },
      );
    }
  } else {
    if (w.ledgerEntryId) {
      await LedgerEntryModel.updateOne({ _id: w.ledgerEntryId }, { $set: { description: 'Withdrawal rejected' } });
    }
    await creditWalletCoins(w.userId, w.amountCoins, `Withdrawal refund · ${w.adminNote}`);
  }

  io()?.to(`user:${String(w.userId)}`).emit('withdrawal.updated', { id: String(w._id), status: w.status });
  const [row] = await enrich([w]);
  res.json(row);
}

module.exports = { listWithdrawals, resolveWithdrawal };
