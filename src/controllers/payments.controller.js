const { z } = require('zod');
const { createOrder, verifyPaymentSignature } = require('../lib/razorpay');
const { fail } = require('../lib/httpError');

// ₹499 + ₹9 GST = ₹508 (50800 paise) for initial vendor registration or the
// agent membership fee; ₹399 + ₹9 GST = ₹408 (40800 paise) for adding a
// service to an existing vendor. Mirrors BASE_FEE_PAISE on the mobile app's
// StepPayment.tsx / AddServiceScreen.tsx — keep these in sync if those change.
const VENDOR_INITIAL_PAISE = 50800;
const VENDOR_ADDITIONAL_PAISE = 40800;
const AGENT_MEMBERSHIP_PAISE = 50800;

const vendorOrderSchema = z.object({
  vendorId: z.string(),
  purpose: z.enum(['INITIAL_REGISTRATION', 'ADDITIONAL_SERVICE']).optional(),
});

async function createVendorOrder(req, res) {
  const body = vendorOrderSchema.parse(req.body);
  const amountPaise = body.purpose === 'ADDITIONAL_SERVICE' ? VENDOR_ADDITIONAL_PAISE : VENDOR_INITIAL_PAISE;
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
