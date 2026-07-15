const Razorpay = require('razorpay');
const crypto = require('node:crypto');
const { env } = require('../config/env');

const client = env.razorpayKeyId && env.razorpayKeySecret
  ? new Razorpay({ key_id: env.razorpayKeyId, key_secret: env.razorpayKeySecret })
  : null;

// Creates a real Razorpay order when keys are configured; otherwise returns a
// mock order id so the app stays demoable without live payment credentials.
async function createOrder(amountPaise, receipt) {
  if (!client) {
    return {
      razorpayOrderId: `order_mock_${crypto.randomUUID()}`,
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
function verifyPaymentSignature({ orderId, paymentId, signature }) {
  if (!env.razorpayKeySecret) {
    // No real Razorpay credentials configured (dev/demo) — orders were mock
    // orders too, so there's nothing real to verify against. Accept, same
    // as createOrder's own mock fallback.
    return true;
  }
  const expected = crypto
    .createHmac('sha256', env.razorpayKeySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  return expected === signature;
}

module.exports = { createOrder, verifyPaymentSignature };
