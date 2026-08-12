const { z } = require('zod');
const { createOrder, verifyPaymentSignature } = require('../lib/razorpay');
const { fail } = require('../lib/httpError');
const { VendorPlanModel } = require('../models/VendorPlan');
const { AgentPlanModel, SINGLETON_ID: AGENT_PLAN_ID } = require('../models/AgentPlan');

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

async function vendorInitialAmountPaise(plan) {
  const planDoc = plan
    ? await VendorPlanModel.findOne({ tier: plan })
    : await VendorPlanModel.findOne({}).sort({ sortOrder: 1 });
  if (plan && !planDoc) fail(400, 'INVALID_PLAN', 'Selected plan is no longer available.');
  const basePaise = planDoc?.baseFeePaise ?? FALLBACK_BASE_PAISE;
  const gstPaise = Math.round((basePaise * GST_RATE_PERCENT) / 100);
  return basePaise + gstPaise;
}

const vendorOrderSchema = z.object({
  vendorId: z.string(),
  purpose: z.enum(['INITIAL_REGISTRATION', 'ADDITIONAL_SERVICE']).optional(),
  plan: z.string().optional(),
});

async function createVendorOrder(req, res) {
  const body = vendorOrderSchema.parse(req.body);
  const amountPaise =
    body.purpose === 'ADDITIONAL_SERVICE'
      ? VENDOR_ADDITIONAL_PAISE
      : await vendorInitialAmountPaise(body.plan);
  const order = await createOrder(amountPaise, `vendor_${body.vendorId}_${body.purpose ?? 'INITIAL_REGISTRATION'}`);
  res.status(201).json(order);
}

const agentOrderSchema = z.object({ purpose: z.enum(['INITIAL_REGISTRATION']).optional() });

async function createAgentOrder(req, res) {
  agentOrderSchema.parse(req.body ?? {});
  const plan = await AgentPlanModel.findById(AGENT_PLAN_ID);
  const basePaise = plan?.baseFeePaise ?? AGENT_FALLBACK_BASE_PAISE;
  const amountPaise = basePaise + AGENT_GST_PAISE;
  const order = await createOrder(amountPaise, `agent_${String(req.user._id)}`);
  res.status(201).json(order);
}

const verifySchema = z.object({
  razorpayOrderId: z.string(),
  razorpayPaymentId: z.string(),
  razorpaySignature: z.string(),
});

// Confirms a Checkout payment actually happened, cryptographically — the
// mobile app must call this after RazorpayCheckout.open() resolves and only
// proceed once it comes back verified, rather than trusting the SDK promise
// alone.
async function verifyPayment(req, res) {
  const body = verifySchema.parse(req.body);
  const verified = verifyPaymentSignature({
    orderId: body.razorpayOrderId,
    paymentId: body.razorpayPaymentId,
    signature: body.razorpaySignature,
  });
  if (!verified) {
    fail(400, 'PAYMENT_NOT_VERIFIED', 'Payment could not be verified.');
  }
  res.json({ verified: true });
}

module.exports = { createVendorOrder, createAgentOrder, verifyPayment };
