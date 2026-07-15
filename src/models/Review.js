const { Schema, model } = require('mongoose');
const { applyIdTransform } = require('./plugins');

const reviewSchema = new Schema(
  {
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    customerName: { type: String, required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    text: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

applyIdTransform(reviewSchema);

const ReviewModel = model('Review', reviewSchema);

module.exports = { ReviewModel };
