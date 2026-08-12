const { Schema, model } = require('mongoose');
const { applyIdTransform } = require('./plugins');

// Vendor registration tiers — used to be hardcoded in StepPayment.jsx
// (mobile) AND duplicated again in payments.controller.js's
// VENDOR_PLAN_BASE_PAISE AND a third time in vendorSelf.controller.js's
// registerVendor. All three now read from this single admin-managed
// collection instead, so a price/quota edit can't silently drift out of
// sync with what Razorpay actually charges (a mismatch there makes
// RazorpayCheckout.open() reject the payment outright).
//
// `tier` is the stable identity — Vendor.plan stores this same string, and
// the booking-quota gate in bookings.controller.js's acceptBooking reads
// serviceQuota off the vendor record itself (not the tier name), so admins
// are free to add/rename/remove tiers without touching that logic.
const vendorPlanSchema = new Schema(
  {
    tier: { type: String, required: true, unique: true, uppercase: true, trim: true },
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
