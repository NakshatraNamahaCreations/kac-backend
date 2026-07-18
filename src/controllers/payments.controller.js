const { z } = require('zod');
const { createOrder, verifyPaymentSignature } = require('../lib/razorpay');
const { fail } = require('../lib/httpError');

// ₹399 + ₹9 flat GST = ₹408 (40800 paise) for adding a service to an
// existing vendor, and the agent membership fee is ₹499 + ₹9 flat GST =
// ₹508 (50800 paise). Mirrors AddServiceScreen.jsx / AgentRegisterMembershipScreen.jsx
// — keep in sync if those change.
const VENDOR_ADDITIONAL_PAISE = 40800;
const AGENT_MEMBERSHIP_PAISE = 50800;

// Initial vendor registration instead scales with the chosen plan and uses
// 18% GST (not the flat ₹9 the other two fees use) — mirrors PLANS /
// gstForBasePaise in StepPayment.jsx exactly. A mismatch here makes
// RazorpayCheckout.open() fail, since its `amount` must match what the
// order was actually created for.
const GST_RATE_PERCENT = 18;
const VENDOR_PLAN_BASE_PAISE = { BASIC: 49900, PRO: 99900 };

function vendorInitialAmountPaise(plan) {
  const basePaise = VENDOR_PLAN_BASE_PAISE[plan] ?? VENDOR_PLAN_BASE_PAISE.BASIC;
  const gstPaise = Math.round((basePaise * GST_RATE_PERCENT) / 100);
  return basePaise + gstPaise;
}

const vendorOrderSchema = z.object({
  vendorId: z.string(),
  purpose: z.enum(['INITIAL_REGISTRATION', 'ADDITIONAL_SERVICE']).optional(),
  plan: z.enum(['BASIC', 'PRO']).optional(),
});

async function createVendorOrder(req, res) {
  const body = vendorOrderSchema.parse(req.body);
  const amountPaise =
    body.purpose === 'ADDITIONAL_SERVICE'
      ? VENDOR_ADDITIONAL_PAISE
      : vendorInitialAmountPaise(body.plan);
  const order = await createOrder(amountPaise, `vendor_${body.vendorId}_${body.purpose ?? 'INITIAL_REGISTRATION'}`);
  res.status(201).json(order);
}

const agentOrderSchema = z.object({ purpose: z.enum(['INITIAL_REGISTRATION']).optional() });

async function createAgentOrder(req, res) {
  agentOrderSchema.parse(req.body ?? {});
  const order = await createOrder(AGENT_MEMBERSHIP_PAISE, `agent_${String(req.user._id)}`);
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
