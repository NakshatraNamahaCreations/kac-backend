const { Schema, model } = require('mongoose');
const { applyIdTransform } = require('./plugins');

// One row per successful customer→customer referral redemption. Powers the
// referrer's "who I referred" history screen.
const customerReferralSchema = new Schema(
  {
    referrerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    referredId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    referredName: { type: String, required: true },
    referredPhone: { type: String, required: true },
    coinsEarned: { type: Number, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

applyIdTransform(customerReferralSchema);

const CustomerReferralModel = model('CustomerReferral', customerReferralSchema);

module.exports = { CustomerReferralModel };
