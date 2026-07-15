const { Schema, model } = require('mongoose');
const { applyIdTransform } = require('./plugins');

const serviceSchema = new Schema(
  {
    name: { type: String, required: true },
    pricePaise: { type: Number, default: null },
  },
  { _id: true },
);
applyIdTransform(serviceSchema);

const geoSchema = new Schema(
  { lat: { type: Number, required: true }, lng: { type: Number, required: true } },
  { _id: false },
);

const vendorSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    name: { type: String, required: true },
    primaryCategoryId: { type: String, required: true },
    categories: { type: [String], default: [] },
    area: { type: String, required: true },
    photoUrl: { type: String, default: null },
    blurhash: { type: String, default: null },
    rating: { type: Number, default: 4.5 },
    reviewCount: { type: Number, default: 0 },
    availability: { type: String, enum: ['ACTIVE', 'AWAY', 'BUSY'], default: 'ACTIVE' },
    verified: { type: Boolean, default: false },
    bio: { type: String, default: '' },
    services: { type: [serviceSchema], default: [] },
    workingHours: { type: String, default: '' },
    phone: { type: String, required: true },
    whatsapp: { type: String, default: null },
    geo: { type: geoSchema, required: true },
    photos: { type: [String], default: [] },
    photoCaptions: { type: Map, of: String, default: undefined },
    personName: { type: String },
    address: { type: String },
    addressPincode: { type: String },
    serviceTags: { type: [String], default: undefined },
    referralStats: {
      appInstalls: { type: Number, default: 0 },
      activations: { type: Number, default: 0 },
    },
    plan: { type: String, enum: ['BASIC', 'PRO'], default: 'BASIC' },
    serviceQuota: { type: Number, default: 10 },
    servicesUsed: { type: Number, default: 0 },
    verificationStatus: {
      type: String,
      enum: ['PENDING_PAYMENT', 'PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED'],
      default: 'PENDING_PAYMENT',
    },
  },
  { timestamps: { createdAt: 'joinedAt', updatedAt: false } },
);

applyIdTransform(vendorSchema);

const VendorModel = model('Vendor', vendorSchema);

module.exports = { VendorModel };
