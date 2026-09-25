const Razorpay = require('razorpay');
const crypto = require('node:crypto');
const { env } = require('../config/env');

const client = env.razorpayKeyId && env.razorpayKeySecret
  ? new Razorpay({ key_id: env.razorpayKeyId, key_secret: env.razorpayKeySecret })
  : null;

// True when real Razorpay credentials are set. Everything payment-gated on the
// server (payment verification, registration/add-service unlocks, wallet
// recharge) only enforces real payment in this mode; without keys the app
// stays demoable end-to-end on mock orders.
const razorpayConfigured = client !== null;

const MOCK_ORDER_PREFIX = 'order_mock_';

// Creates a real Razorpay order when keys are configured; otherwise returns a
// mock order id so the app stays demoable without live payment credentials.
async function createOrder(amountPaise, receipt) {
  if (!client) {
    return {
      razorpayOrderId: `${MOCK_ORDER_PREFIX}${crypto.randomUUID()}`,
      amountPaise,
      keyId: 'rzp_test_placeholder',
    };
  }
  const order = await client.orders.create({
    amount: amountPaise,
    currency: 'INR',
    receipt,
  });
  return {
    razorpayOrderId: order.id,
    amountPaise,
    keyId: env.razorpayKeyId,
  };
}

// Standard Razorpay Checkout signature check: HMAC-SHA256 of
// "order_id|payment_id" using the key secret, compared to the signature
// Checkout returned. This is the server-side confirmation the app's own
// rule requires — a resolved RazorpayCheckout.open() promise alone is just
// a client SDK callback, not proof the payment actually happened.
//
// Fails CLOSED: with real keys configured, a mock order id or a bad
// signature is never accepted. Only when no keys exist at all (dev/demo,
// where every order was a mock too) is a mock order waved through.
function verifyPaymentSignature({ orderId, paymentId, signature }) {
  if (!razorpayConfigured) {
    return orderId.startsWith(MOCK_ORDER_PREFIX);
  }
  if (orderId.startsWith(MOCK_ORDER_PREFIX)) return false;
  const expected = crypto
    .createHmac('sha256', env.razorpayKeySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { createOrder, verifyPaymentSignature, razorpayConfigured };
