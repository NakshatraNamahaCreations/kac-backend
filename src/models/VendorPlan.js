const { Schema, model } = require('mongoose');
const { applyIdTransform } = require('./plugins');

// The two vendor registration tiers — used to be hardcoded in
// StepPayment.jsx (mobile) AND duplicated again in payments.controller.js's
// VENDOR_PLAN_BASE_PAISE AND a third time in vendorSelf.controller.js's
// registerVendor. All three now read from this single collection instead,
// so an admin price/quota edit can't silently drift out of sync with what
// Razorpay actually charges (a mismatch there makes RazorpayCheckout.open()
// reject the payment outright).
//
// `tier` is intentionally a fixed enum, not free text — Vendor.plan and the
// booking-quota gate in agent.controller.js's acceptBooking both assume
// exactly these two tiers exist. Admins edit price/copy, not add new tiers.
const vendorPlanSchema = new Schema(
  {
    tier: { type: String, enum: ['BASIC', 'PRO'], required: true, unique: true },
    label: { type: String, required: true },
    tagline: { type: String, default: '' },
    baseFeePaise: { type: Number, required: true, min: 0 },
    // null = unlimited (PRO's default) — mirrors Vendor.serviceQuota's own convention.
    serviceQuota: { type: Number, default: null },
    badge: { type: String, default: null },
    bullets: { type: [String], default: [] },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);

applyIdTransform(vendorPlanSchema);
const VendorPlanModel = model('VendorPlan', vendorPlanSchema);

module.exports = { VendorPlanModel };
