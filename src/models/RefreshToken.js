const { Schema, model } = require('mongoose');

const refreshTokenSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  jti: { type: String, required: true, unique: true },
  revoked: { type: Boolean, default: false },
  createdAt: { type: Date, default: () => new Date() },
  // TTL cleanup — matches JWT_REFRESH_TTL's default of 30 days.
  expiresAt: { type: Date, required: true, expires: 0 },
});

const RefreshTokenModel = model('RefreshToken', refreshTokenSchema);

module.exports = { RefreshTokenModel };
