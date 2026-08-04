const { Schema, model } = require('mongoose');
const { applyIdTransform } = require('./plugins');

// One row per successful vendor→(customer|vendor|agent) referral redemption.
// Powers the referring vendor's "who I referred" history screen.
const vendorReferralSchema = new Schema(
  {
    referrerVendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
    referredName: { type: String, required: true },
    referredPhone: { type: String, required: true },
    referredRole: { type: String, enum: ['customer', 'vendor', 'agent'], required: true },
    coinsEarned: { type: Number, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

applyIdTransform(vendorReferralSchema);

const VendorReferralModel = model('VendorReferral', vendorReferralSchema);

module.exports = { VendorReferralModel };
