const { Schema, model } = require('mongoose');
const { applyIdTransform } = require('./plugins');

const onboardingSchema = new Schema(
  {
    agentId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    vendorPhone: { type: String, required: true },
    vendorName: { type: String, required: true },
    status: { type: String, enum: ['PENDING', 'ACTIVE', 'SUSPENDED'], default: 'PENDING' },
    earningsCoins: { type: Number, default: 0 },
    categoryIds: { type: [String], default: undefined },
    area: { type: String },
    phoneVerified: { type: Boolean, default: false },
    aadhaarNumber: { type: String },
    aadhaarName: { type: String },
    aadhaarPhotoKey: { type: String },
    panNumber: { type: String },
    panPhotoKey: { type: String },
    gstNumber: { type: String },
    gstPhotoKey: { type: String },
    businessName: { type: String },
    ownerName: { type: String },
    shopPhotoKey: { type: String },
    establishedYear: { type: String },
    locationLat: { type: Number },
    locationLng: { type: Number },
    placeTags: { type: [String], default: undefined },
    serviceTags: { type: [String], default: undefined },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

applyIdTransform(onboardingSchema);

const OnboardingModel = model('Onboarding', onboardingSchema);

module.exports = { OnboardingModel };
