const { Schema, model } = require('mongoose');
const { applyIdTransform } = require('./plugins');

const roleEnum = ['customer', 'vendor', 'agent', 'employee'];

const pushTokenSchema = new Schema(
  {
    token: { type: String, required: true },
    platform: { type: String, enum: ['ios', 'android', 'web'], required: true },
  },
  { _id: false },
);

const userSchema = new Schema(
  {
    phone: { type: String, required: true, unique: true, index: true },
    name: { type: String, default: null },
    language: { type: String, default: 'en' },
    roles: { type: [String], enum: roleEnum, default: [] },
    avatarUrl: { type: String, default: null },
    area: { type: String, default: null },
    address: { type: String, default: null },
    pushTokens: { type: [pushTokenSchema], default: [] },
    walletCoins: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

applyIdTransform(userSchema);

const UserModel = model('User', userSchema);

module.exports = { UserModel };
