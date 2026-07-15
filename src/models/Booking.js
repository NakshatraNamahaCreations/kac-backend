const { Schema, model } = require('mongoose');
const { applyIdTransform } = require('./plugins');

const bookingSchema = new Schema(
  {
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    customerName: { type: String, required: true },
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
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

applyIdTransform(bookingSchema);

const BookingModel = model('Booking', bookingSchema);

module.exports = { BookingModel };
