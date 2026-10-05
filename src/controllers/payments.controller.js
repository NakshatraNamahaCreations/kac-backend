const { z } = require('zod');
const { createOrder, verifyPaymentSignature, razorpayConfigured } = require('../lib/razorpay');
const { fail } = require('../lib/httpError');
const { VendorPlanModel } = require('../models/VendorPlan');
const { AgentPlanModel, SINGLETON_ID: AGENT_PLAN_ID } = require('../models/AgentPlan');
const { PaymentModel } = require('../models/Payment');
const { VendorModel } = require('../models/Vendor');
const { normalizePhone } = require('../lib/phone');
const { creditWalletCoins } = require('./wallet.controller');
const { creditCustomerCoins } = require('./customerWallet.controller');

// ₹399 + ₹9 flat GST = ₹408 (40800 paise) for adding a service to an
// existing vendor. Mirrors AddServiceScreen.jsx — keep in sync if it changes.
const VENDOR_ADDITIONAL_PAISE = 40800;

// Agent membership uses a flat ₹9 GST (not the 18% vendor plans use) —
// basePaise is admin-managed (see AgentPlan model / agentPlan.controller.js)
// and read from the SAME collection AgentRegisterMembershipScreen.jsx
// fetches to render the fee card, so an admin price edit can't drift out of
// sync with what Razorpay actually charges.
const AGENT_GST_PAISE = 900;
// Only used if the AgentPlan singleton is somehow missing — a last-resort
// so order creation doesn't hard-crash.
const AGENT_FALLBACK_BASE_PAISE = 49900;

// Initial vendor registration instead scales with the chosen plan (admin-
// managed — see VendorPlan model / vendorPlan.controller.js, any number of
// tiers) and uses 18% GST (not the flat ₹9 the other two fees use).
// basePaise is read from the SAME collection StepPayment.jsx fetches to
// render the picker — previously this was a separately hardcoded object
// that had to be kept in sync by hand, which is exactly the kind of drift
// that makes RazorpayCheckout.open() reject the payment (its `amount` must
// match what the order was actually created for).
const GST_RATE_PERCENT = 18;
// Only used if the VendorPlan collection is completely empty (should never
// happen post-seed) — a last-resort so order creation doesn't hard-crash.
const FALLBACK_BASE_PAISE = 49900;

// Wallet recharge bounds (coins == ₹). Razorpay's own minimum order is ₹1;
// the ceiling just stops a fat-fingered/abusive order.
const MIN_RECHARGE_COINS = 1;
const MAX_RECHARGE_COINS = 100000;

async function vendorInitialAmountPaise(plan) {
  const planDoc = plan
    ? await VendorPlanModel.findOne({ tier: plan })
    : await VendorPlanModel.findOne({}).sort({ sortOrder: 1 });
  if (plan && !planDoc) fail(400, 'INVALID_PLAN', 'Selected plan is no longer available.');
  const basePaise = planDoc?.baseFeePaise ?? FALLBACK_BASE_PAISE;
  const gstPaise = Math.round((basePaise * GST_RATE_PERCENT) / 100);
  return basePaise + gstPaise;
}

async function recordOrder(userId, purpose, order, extra = {}) {
  await PaymentModel.create({
    razorpayOrderId: order.razorpayOrderId,
    userId,
    purpose,
    amountPaise: order.amountPaise,
    ...extra,
  });
}

const vendorOrderSchema = z.object({
  vendorId: z.string(),
  purpose: z.enum(['INITIAL_REGISTRATION', 'ADDITIONAL_SERVICE']).optional(),
  plan: z.string().optional(),
});

async function createVendorOrder(req, res) {
  const body = vendorOrderSchema.parse(req.body);
  const isAddService = body.purpose === 'ADDITIONAL_SERVICE';
  const amountPaise = isAddService ? VENDOR_ADDITIONAL_PAISE : await vendorInitialAmountPaise(body.plan);
  const order = await createOrder(amountPaise, `vendor_${String(req.user._id)}_${body.purpose ?? 'INITIAL_REGISTRATION'}`);
  await recordOrder(
    req.user._id,
    isAddService ? 'VENDOR_ADDITIONAL_SERVICE' : 'VENDOR_REGISTRATION',
    order,
    isAddService ? {} : { plan: body.plan ?? null },
  );
  res.status(201).json(order);
}

const onboardingOrderSchema = z.object({
  vendorPhone: z.string().min(6),
  plan: z.string().min(1),
});

// Agent collects the vendor's registration fee in person and pays it here,
// before submitting the onboarding. Priced exactly like the vendor's own
// registration order (same admin-managed plan + 18% GST), so the vendor gets
// the same plan whichever way it's paid.
async function createOnboardingOrder(req, res) {
  const body = onboardingOrderSchema.parse(req.body);
  const vendorPhone = normalizePhone(body.vendorPhone);
  // Never take money for a phone that's already a vendor — that fee could
  // never be used.
  if (await VendorModel.exists({ phone: vendorPhone })) {
    fail(409, 'ALREADY_VENDOR', 'This phone number is already registered as a vendor.');
  }
  const amountPaise = await vendorInitialAmountPaise(body.plan);
  const order = await createOrder(amountPaise, `onboard_${String(req.user._id)}`);
  await recordOrder(req.user._id, 'VENDOR_ONBOARDING', order, { plan: body.plan, vendorPhone });
  res.status(201).json(order);
}

const agentOrderSchema = z.object({ purpose: z.enum(['INITIAL_REGISTRATION']).optional() });

async function createAgentOrder(req, res) {
  agentOrderSchema.parse(req.body ?? {});
  const plan = await AgentPlanModel.findById(AGENT_PLAN_ID);
  const basePaise = plan?.baseFeePaise ?? AGENT_FALLBACK_BASE_PAISE;
  const amountPaise = basePaise + AGENT_GST_PAISE;
  const order = await createOrder(amountPaise, `agent_${String(req.user._id)}`);
  await recordOrder(req.user._id, 'AGENT_MEMBERSHIP', order);
  res.status(201).json(order);
}

const walletOrderSchema = z.object({
  coins: z.number().int().min(MIN_RECHARGE_COINS).max(MAX_RECHARGE_COINS),
});

// 1 coin = ₹1, so the charge is coins * 100 paise. The coins to credit are
// stored on the Payment row and credited from THERE at verify time — never
// from anything the client sends back after paying.
function makeWalletOrderHandler(purpose, receiptPrefix) {
  return async function createWalletOrder(req, res) {
    const { coins } = walletOrderSchema.parse(req.body);
    const order = await createOrder(coins * 100, `${receiptPrefix}_${String(req.user._id)}`);
    await recordOrder(req.user._id, purpose, order, { coins });
    res.status(201).json(order);
  };
}

const createWalletOrder = makeWalletOrderHandler('WALLET_RECHARGE', 'wallet');
const createCustomerWalletOrder = makeWalletOrderHandler('CUSTOMER_RECHARGE', 'custcoins');

const verifySchema = z.object({
  razorpayOrderId: z.string(),
  razorpayPaymentId: z.string(),
  razorpaySignature: z.string(),
});

// Confirms a Checkout payment actually happened, cryptographically — the
// mobile app must call this after RazorpayCheckout.open() resolves and only
// proceed once it comes back verified, rather than trusting the SDK promise
// alone. The order must be one THIS server created for THIS user; the
// CREATED -> PAID flip is atomic, so a replayed/duplicate verify never
// credits a wallet twice.
async function verifyPayment(req, res) {
  const body = verifySchema.parse(req.body);
  const payment = await PaymentModel.findOne({ razorpayOrderId: body.razorpayOrderId, userId: req.user._id });
  if (!payment) fail(404, 'ORDER_NOT_FOUND', 'Payment order not found.');

  if (payment.status === 'PAID') {
    res.json({ verified: true, purpose: payment.purpose });
    return;
  }

  const verified = verifyPaymentSignature({
    orderId: body.razorpayOrderId,
    paymentId: body.razorpayPaymentId,
    signature: body.razorpaySignature,
  });
  if (!verified) {
    fail(400, 'PAYMENT_NOT_VERIFIED', 'Payment could not be verified.');
  }

  const claimed = await PaymentModel.findOneAndUpdate(
    { _id: payment._id, status: 'CREATED' },
    { status: 'PAID', razorpayPaymentId: body.razorpayPaymentId, paidAt: new Date() },
    { new: true },
  );
  if (!claimed) {
    // Lost a race with a concurrent verify of the same order — it already
    // did the crediting.
    res.json({ verified: true, purpose: payment.purpose });
    return;
  }

  const result = { verified: true, purpose: claimed.purpose };
  if (claimed.purpose === 'WALLET_RECHARGE') {
    result.balance = await creditWalletCoins(req.user._id, claimed.coins, 'Wallet recharge');
    result.coins = claimed.coins;
  } else if (claimed.purpose === 'CUSTOMER_RECHARGE') {
    result.balance = await creditCustomerCoins(req.user._id, claimed.coins, 'Wallet recharge');
    result.coins = claimed.coins;
  }
  res.json(result);
}

// Called by the endpoint a payment unlocks (registerVendor, add-service,
// registerAgent): requires one PAID, not-yet-used payment of `purpose` for
// this user and marks it used, so a single payment can't unlock twice.
// No-op without real Razorpay keys (demo/mock mode has nothing real to check).
async function consumePaidPayment(userId, purpose, { plan } = {}) {
  if (!razorpayConfigured) return;
  const filter = { userId, purpose, status: 'PAID', consumed: false };
  if (plan) filter.plan = plan;
  const payment = await PaymentModel.findOneAndUpdate(filter, { consumed: true }, { sort: { paidAt: 1 } });
  if (!payment) {
    fail(402, 'PAYMENT_REQUIRED', 'Payment is required before you can continue.');
  }
}

// GET /payments/registration-status?purpose=VENDOR_REGISTRATION|AGENT_MEMBERSHIP
// Signup now takes the fee FIRST and the details after, so someone can pay,
// close the app, and come back later. This tells the app a verified fee is
// already waiting to be used, so it skips straight past payment instead of
// charging again. { paid, plan, amountPaise }
async function getRegistrationPaymentStatus(req, res) {
  const purpose = req.query.purpose === 'AGENT_MEMBERSHIP' ? 'AGENT_MEMBERSHIP' : 'VENDOR_REGISTRATION';
  const payment = await PaymentModel.findOne({
    userId: req.user._id,
    purpose,
    status: 'PAID',
    consumed: false,
  }).sort({ paidAt: 1 });
  res.json({
    paid: !!payment,
    plan: payment?.plan ?? null,
    amountPaise: payment?.amountPaise ?? null,
  });
}

// createOnboarding's counterpart to consumePaidPayment: requires the agent's
// PAID, unused VENDOR_ONBOARDING payment for exactly this vendor phone + plan
// and marks it used. Returns the Payment id, or null in demo mode (no
// Razorpay keys — nothing real to check, same as consumePaidPayment).
async function consumeOnboardingPayment(agentUserId, vendorPhone, plan) {
  if (!razorpayConfigured) return null;
  const payment = await PaymentModel.findOneAndUpdate(
    { userId: agentUserId, purpose: 'VENDOR_ONBOARDING', vendorPhone, plan, status: 'PAID', consumed: false },
    { consumed: true },
    { sort: { paidAt: 1 }, new: true },
  );
  if (!payment) {
    fail(402, 'PAYMENT_REQUIRED', "Collect the vendor's registration fee before submitting.");
  }
  return payment._id;
}

module.exports = {
  getRegistrationPaymentStatus,
  createVendorOrder,
  createOnboardingOrder,
  consumeOnboardingPayment,
  createAgentOrder,
  createWalletOrder,
  createCustomerWalletOrder,
  verifyPayment,
  consumePaidPayment,
};
