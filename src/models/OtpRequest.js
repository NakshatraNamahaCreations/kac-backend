const { Schema, model } = require('mongoose');

// TTL index auto-expires stale OTP requests 10 minutes after creation.
const otpRequestSchema = new Schema({
  phone: { type: String, required: true },
  code: { type: String, required: true },
  consumed: { type: Boolean, default: false },
  createdAt: { type: Date, default: () => new Date(), expires: 600 },
});

const OtpRequestModel = model('OtpRequest', otpRequestSchema);

module.exports = { OtpRequestModel };
