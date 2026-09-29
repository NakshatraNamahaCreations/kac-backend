const { PaymentModel, PAYMENT_PURPOSES } = require('../models/Payment');
const { UserModel } = require('../models/User');
const { VendorModel } = require('../models/Vendor');
const { VendorPlanModel } = require('../models/VendorPlan');
const { OnboardingModel } = require('../models/Onboarding');
const { buildPage, parseCursor } = require('../lib/pagination');

const PAGE_LIMIT = 25;
// Upper bound for the admin's CSV export — one request, no paging.
const EXPORT_LIMIT = 5000;

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseDate(v) {
  if (typeof v !== 'string' || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Filters shared by the list and its summary: status, purpose, date range
// (on createdAt) and a free-text search over the payer (name / phone), the
// vendor phone an agent paid for, and the Razorpay order / payment ids.
async function buildFilter(query) {
  const filter = {};
  if (query.status === 'PAID' || query.status === 'CREATED') filter.status = query.status;
  if (typeof query.purpose === 'string' && PAYMENT_PURPOSES.includes(query.purpose)) {
    filter.purpose = query.purpose;
  }
  const from = parseDate(query.from);
  const to = parseDate(query.to);
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = from;
    if (to) filter.createdAt.$lte = to;
  }
  const search = typeof query.search === 'string' ? query.search.trim() : '';
  if (search) {
    const re = new RegExp(escapeRegex(search), 'i');
    const users = await UserModel.find({ $or: [{ name: re }, { phone: re }] }, '_id').limit(500);
    filter.$or = [
      { userId: { $in: users.map((u) => u._id) } },
      { vendorPhone: re },
      { razorpayOrderId: re },
      { razorpayPaymentId: re },
    ];
  }
  return filter;
}

// Adds who paid and what for, from the collections the Payment row points at:
//   payer    — the User who paid (name, phone, roles)
//   vendor   — the payer's vendor business, for vendor fees
//   onboarded — for agent-paid onboarding: the vendor it was paid for
//   planLabel — human name of the vendor plan tier
async function enrich(payments) {
  const userIds = [...new Set(payments.map((p) => String(p.userId)))];
  const onboardingPaymentIds = payments.filter((p) => p.purpose === 'VENDOR_ONBOARDING').map((p) => p._id);
  const [users, vendors, onboardings, plans] = await Promise.all([
    UserModel.find({ _id: { $in: userIds } }, 'name phone roles'),
    VendorModel.find({ userId: { $in: userIds } }, 'userId name personName'),
    onboardingPaymentIds.length
      ? OnboardingModel.find({ prepaidPaymentId: { $in: onboardingPaymentIds } }, 'prepaidPaymentId vendorName vendorPhone status prepaidUsed')
      : [],
    VendorPlanModel.find({}, 'tier label'),
  ]);
  const userById = new Map(users.map((u) => [String(u._id), u]));
  const vendorByUser = new Map(vendors.map((v) => [String(v.userId), v]));
  const onboardingByPayment = new Map(onboardings.map((o) => [String(o.prepaidPaymentId), o]));
  const planLabel = new Map(plans.map((p) => [p.tier, p.label]));

  return payments.map((p) => {
    const user = userById.get(String(p.userId));
    const vendor = vendorByUser.get(String(p.userId));
    const onboarding = onboardingByPayment.get(String(p._id));
    const isVendorFee = p.purpose === 'VENDOR_REGISTRATION' || p.purpose === 'VENDOR_ADDITIONAL_SERVICE';
    return {
      id: String(p._id),
      createdAt: p.createdAt,
      paidAt: p.paidAt,
      status: p.status,
      purpose: p.purpose,
      amountPaise: p.amountPaise,
      coins: p.coins,
      plan: p.plan,
      planLabel: p.plan ? planLabel.get(p.plan) ?? p.plan : null,
      used: p.consumed,
      razorpayOrderId: p.razorpayOrderId,
      razorpayPaymentId: p.razorpayPaymentId,
      payer: user
        ? { id: String(user._id), name: user.name ?? null, phone: user.phone, roles: user.roles }
        : { id: String(p.userId), name: null, phone: null, roles: [] },
      vendor: isVendorFee && vendor ? { name: vendor.name, personName: vendor.personName ?? null } : null,
      onboarded:
        p.purpose === 'VENDOR_ONBOARDING'
          ? {
              vendorName: onboarding?.vendorName ?? null,
              vendorPhone: onboarding?.vendorPhone ?? p.vendorPhone,
              // Paid but the agent never submitted the onboarding.
              status: onboarding ? (onboarding.prepaidUsed ? 'REGISTERED' : onboarding.status) : 'NOT_SUBMITTED',
            }
          : null,
    };
  });
}

// Totals across EVERY payment matching the filter (not just the loaded
// page): collected (PAID) amount + count, per-purpose breakdown, and how
// many orders were started but never paid.
async function summarize(filter) {
  const [byPurpose, unpaid] = await Promise.all([
    PaymentModel.aggregate([
      { $match: { ...filter, status: 'PAID' } },
      { $group: { _id: '$purpose', count: { $sum: 1 }, amountPaise: { $sum: '$amountPaise' } } },
    ]),
    PaymentModel.countDocuments({ ...filter, status: 'CREATED' }),
  ]);
  const totals = byPurpose.reduce(
    (acc, r) => ({ count: acc.count + r.count, amountPaise: acc.amountPaise + r.amountPaise }),
    { count: 0, amountPaise: 0 },
  );
  return {
    paidCount: totals.count,
    paidAmountPaise: totals.amountPaise,
    unpaidCount: filter.status === 'PAID' ? 0 : unpaid,
    byPurpose: byPurpose
      .map((r) => ({ purpose: r._id, count: r.count, amountPaise: r.amountPaise }))
      .sort((a, b) => b.amountPaise - a.amountPaise),
  };
}

// GET /admin/payments?status&purpose&search&from&to&cursor[&export=1]
// First page also carries `summary`; export=1 returns every match (capped)
// in one response for the admin's CSV download.
async function listPayments(req, res) {
  const filter = await buildFilter(req.query);

  if (req.query.export === '1') {
    const payments = await PaymentModel.find(filter).sort({ createdAt: -1 }).limit(EXPORT_LIMIT);
    res.json({ data: await enrich(payments), truncated: payments.length === EXPORT_LIMIT });
    return;
  }

  const skip = parseCursor(typeof req.query.cursor === 'string' ? req.query.cursor : undefined);
  const [total, payments, summary] = await Promise.all([
    PaymentModel.countDocuments(filter),
    PaymentModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(PAGE_LIMIT),
    skip === 0 ? summarize(filter) : null,
  ]);
  const page = buildPage(await enrich(payments), skip, PAGE_LIMIT, total);
  res.json({ ...page, total, ...(summary ? { summary } : {}) });
}

module.exports = { listPayments };
