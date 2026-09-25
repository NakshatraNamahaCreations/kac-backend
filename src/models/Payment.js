const { Schema, model } = require('mongoose');
const { applyIdTransform } = require('./plugins');

const PAYMENT_PURPOSES = [
  'VENDOR_REGISTRATION',
  'VENDOR_ADDITIONAL_SERVICE',
  'AGENT_MEMBERSHIP',
  'WALLET_RECHARGE',
  'CUSTOMER_RECHARGE',
];

// One row per Razorpay order we create. The order is bound to the user,
// purpose and amount at creation time, so /payments/verify can confirm a
// signature against something the SERVER remembers instead of trusting the
// client's word for what was paid. Registration-type purposes are "consumed"
// once by the endpoint they unlock (registerVendor, add-service, registerAgent);
// recharge purposes credit a wallet inside verify and are idempotent via the
// CREATED -> PAID transition.
const paymentSchema = new Schema(
  {
    razorpayOrderId: { type: String, required: true, unique: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    purpose: { type: String, enum: PAYMENT_PURPOSES, required: true },
    amountPaise: { type: Number, required: true },
    // Wallet recharges only — coins credited on success (1 coin = ₹1).
    coins: { type: Number, default: null },
    // Vendor registration only — the plan tier this payment was made for.
    plan: { type: String, default: null },
    status: { type: String, enum: ['CREATED', 'PAID'], default: 'CREATED', index: true },
    razorpayPaymentId: { type: String, default: null },
    paidAt: { type: Date, default: null },
    consumed: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

applyIdTransform(paymentSchema);

const PaymentModel = model('Payment', paymentSchema);

module.exports = { PaymentModel, PAYMENT_PURPOSES };
