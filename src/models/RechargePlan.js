const { Schema, model } = require('mongoose');
const { applyIdTransform } = require('./plugins');

// Customer wallet recharge presets — used to be a hardcoded array in
// CustomerRechargeScreen.jsx; now admin-managed so pricing/pack sizes can
// change without a client release. Coins are 1:1 INR (money.js convention),
// so `coins` alone doubles as "amount in rupees" — no separate price field.
// `calls` is admin-set directly rather than derived from a fixed
// coins-per-call rate, so a promotional pack can offer a better-than-usual
// rate without that rate needing to be hardcoded anywhere.
const rechargePlanSchema = new Schema(
  {
    coins: { type: Number, required: true, min: 1 },
    calls: { type: Number, required: true, min: 1 },
    label: { type: String, default: null },
    active: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: true } },
);

applyIdTransform(rechargePlanSchema);
const RechargePlanModel = model('RechargePlan', rechargePlanSchema);

module.exports = { RechargePlanModel };
