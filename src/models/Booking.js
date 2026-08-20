const { Schema, model } = require('mongoose');
const { applyIdTransform } = require('./plugins');

const bookingSchema = new Schema(
  {
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    customerName: { type: String, required: true },
    customerPhone: { type: String, default: null },
    customerAvatarUrl: { type: String, default: null },
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
    vendorName: { type: String, required: true },
    serviceId: { type: String, required: true },
    serviceName: { type: String, required: true },
    date: { type: String, required: true },
    slot: { type: String, required: true },
    notes: { type: String, default: null },
    status: {
      type: String,
      enum: ['REQUESTED', 'ACCEPTED', 'DECLINED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
      default: 'REQUESTED',
      index: true,
    },
    // Set only when an agent/vendor logged this on the customer's behalf
    // (bookings.controller.js's createManualBooking) — null for a booking
    // the customer made themselves through the app. referralFeeCoins mirrors
    // the exact amount charged to referredBy's wallet at creation time, so
    // "My referrals" history (ReferredBookingsScreen.jsx) can show it without
    // re-deriving it from the vendor's current (possibly since-changed)
    // service price.
    referredBy: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    referralFeeCoins: { type: Number, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

applyIdTransform(bookingSchema);

const BookingModel = model('Booking', bookingSchema);

module.exports = { BookingModel };
