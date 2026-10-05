const { isValidObjectId } = require('mongoose');
const { UserModel } = require('../models/User');
const { VendorModel } = require('../models/Vendor');
const { AgentModel } = require('../models/Agent');
const { EmployeeModel, EmployeeReferralModel } = require('../models/Employee');
const { LedgerEntryModel } = require('../models/LedgerEntry');
const { buildPage, parseCursor } = require('../lib/pagination');
const { fail } = require('../lib/httpError');

// Wallet balances for the admin panel. 1 coin = ₹1 everywhere.
//   customer — User.walletCoins (coins customers spend to contact vendors)
//   vendor   — the vendor's Agent document's walletCoins (vendors earn
//              referral cashback into the same wallet type agents use)
//   agent    — Agent.walletCoins
const PAGE_LIMIT = 25;

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function sumCoins(model, match) {
  const [r] = await model.aggregate([
    { $match: match },
    { $group: { _id: null, coins: { $sum: '$walletCoins' }, count: { $sum: 1 } } },
  ]);
  return { coins: r?.coins ?? 0, count: r?.count ?? 0 };
}

// Totals across every wallet of each type.
async function walletSummary() {
  const [agentUserIds, vendorUserIds] = await Promise.all([
    UserModel.find({ roles: 'agent' }).distinct('_id'),
    VendorModel.find({}).distinct('userId'),
  ]);
  const [customer, agent, vendor] = await Promise.all([
    sumCoins(UserModel, { roles: 'customer' }),
    sumCoins(AgentModel, { userId: { $in: agentUserIds } }),
    // A person who is both vendor and agent has one shared wallet — counted
    // under agent only, so the two totals never double-count it.
    sumCoins(AgentModel, { userId: { $in: vendorUserIds.filter((id) => !agentUserIds.some((a) => a.equals(id))) } }),
  ]);
  return {
    customer: { ...customer, holders: await UserModel.countDocuments({ roles: 'customer' }) },
    vendor: { ...vendor, holders: vendorUserIds.length },
    agent: { ...agent, holders: agentUserIds.length },
    // Employees have no earnings wallet of their own — this is the coin
    // balance on their user account (if they also use the app as a
    // customer), shown so admins see every role in one place.
    employee: {
      ...(await sumCoins(UserModel, { roles: 'employee' })),
      holders: await EmployeeModel.countDocuments(),
    },
  };
}

// GET /admin/wallets?role=customer|vendor|agent&search&cursor
// Highest balances first. First page also carries `summary`.
async function listWallets(req, res) {
  const role = ['customer', 'vendor', 'agent', 'employee'].includes(req.query.role) ? req.query.role : 'customer';
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const searchRe = search ? new RegExp(escapeRegex(search), 'i') : null;
  const skip = parseCursor(typeof req.query.cursor === 'string' ? req.query.cursor : undefined);

  let total;
  let rows;
  if (role === 'employee') {
    // Employee record (ID, area, referral code, how many people they've
    // referred) + the coin balance on their user account.
    const userFilter = { roles: 'employee', ...(searchRe ? { $or: [{ name: searchRe }, { phone: searchRe }] } : {}) };
    const users = await UserModel.find(userFilter, 'name phone walletCoins');
    const userById = new Map(users.map((u) => [String(u._id), u]));
    const employees = await EmployeeModel.find({ userId: { $in: users.map((u) => u._id) } });
    const counts = await EmployeeReferralModel.aggregate([
      { $match: { employeeId: { $in: employees.map((e) => e._id) } } },
      { $group: { _id: '$employeeId', n: { $sum: 1 } } },
    ]);
    const referralsBy = new Map(counts.map((c) => [String(c._id), c.n]));
    const all = employees
      .map((e) => {
        const u = userById.get(String(e.userId));
        return {
          userId: String(e.userId),
          name: u?.name ?? null,
          phone: u?.phone ?? null,
          employeeId: e.employeeId,
          area: e.areaAssigned,
          referralCode: e.referralCode,
          referrals: referralsBy.get(String(e._id)) ?? 0,
          coins: u?.walletCoins ?? 0,
        };
      })
      .sort((a, b) => b.referrals - a.referrals || b.coins - a.coins);
    total = all.length;
    rows = all.slice(skip, skip + PAGE_LIMIT);
  } else if (role === 'customer') {
    const filter = { roles: 'customer', ...(searchRe ? { $or: [{ name: searchRe }, { phone: searchRe }] } : {}) };
    const users = await UserModel.find(filter, 'name phone roles walletCoins')
      .sort({ walletCoins: -1, _id: 1 })
      .skip(skip)
      .limit(PAGE_LIMIT);
    total = await UserModel.countDocuments(filter);
    rows = users.map((u) => ({
      userId: String(u._id),
      name: u.name ?? null,
      phone: u.phone,
      roles: u.roles,
      coins: u.walletCoins ?? 0,
    }));
  } else {
    // Whose wallets: vendors (by Vendor record) or registered agents.
    let owners;
    if (role === 'vendor') {
      const vendors = await VendorModel.find(
        searchRe ? { $or: [{ name: searchRe }, { phone: searchRe }, { personName: searchRe }] } : {},
        'userId name personName phone',
      );
      owners = new Map(vendors.map((v) => [String(v.userId), { name: v.name, personName: v.personName, phone: v.phone }]));
    } else {
      const users = await UserModel.find(
        { roles: 'agent', ...(searchRe ? { $or: [{ name: searchRe }, { phone: searchRe }] } : {}) },
        'name phone',
      );
      owners = new Map(users.map((u) => [String(u._id), { name: u.name, phone: u.phone }]));
    }
    const ids = [...owners.keys()];
    const agents = await AgentModel.find({ userId: { $in: ids } }, 'userId walletCoins');
    const coinsByUser = new Map(agents.map((a) => [String(a.userId), a.walletCoins ?? 0]));
    // Wallet doc may not exist yet (never credited) — that's a 0 balance.
    const all = ids
      .map((id) => ({ userId: id, ...owners.get(id), coins: coinsByUser.get(id) ?? 0 }))
      .sort((a, b) => b.coins - a.coins);
    total = all.length;
    rows = all.slice(skip, skip + PAGE_LIMIT).map((r) => ({
      userId: r.userId,
      name: r.name ?? null,
      personName: r.personName ?? null,
      phone: r.phone ?? null,
      coins: r.coins,
    }));
  }

  const page = buildPage(rows, skip, PAGE_LIMIT, total);
  res.json({ ...page, total, ...(skip === 0 ? { summary: await walletSummary() } : {}) });
}

// GET /admin/wallets/:userId/ledger?pool=customer|agent — last 100
// transactions of one wallet. Entries from before wallets were tagged
// (pool null) are included in both, as the apps show them.
async function getWalletLedger(req, res) {
  const { userId } = req.params;
  if (!isValidObjectId(userId)) fail(404, 'NOT_FOUND', 'Wallet not found.');
  const pool = req.query.pool === 'customer' ? 'customer' : 'agent';
  const entries = await LedgerEntryModel.find({
    ownerId: userId,
    pool: { $ne: pool === 'customer' ? 'agent' : 'customer' },
  })
    .sort({ createdAt: -1 })
    .limit(100);
  res.json({
    data: entries.map((e) => ({
      id: String(e._id),
      createdAt: e.createdAt,
      kind: e.kind,
      coins: e.coins,
      balance: e.balance,
      description: e.description,
    })),
  });
}

module.exports = { listWallets, getWalletLedger };
