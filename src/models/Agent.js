const { Schema, model } = require('mongoose');
const { applyIdTransform } = require('./plugins');

const bankAccountSchema = new Schema(
  {
    accountHolder: { type: String, required: true },
    accountNumberMasked: { type: String, required: true },
    // Full number, AES-256-GCM encrypted (lib/aadhaarVault.js). Admin only.
    accountNumberEnc: { type: String, default: null },
    ifsc: { type: String, required: true },
  },
  { _id: true },
);
applyIdTransform(bankAccountSchema);

const agentSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    executiveCode: { type: String, required: true, unique: true },
    area: { type: String },
    bankAccounts: { type: [bankAccountSchema], default: [] },
    walletCoins: { type: Number, default: 0 },
    // Admin approval, like Vendor.verificationStatus. Set to
    // PENDING_VERIFICATION when someone registers as an agent; only an admin
    // moves it to ACTIVE (admin.controller.js updateAgentVerification).
    // null = agents from before verification existed (treated as ACTIVE), and
    // the wallet-only Agent docs vendors get (see agent.controller.js
    // requireOwnAgent) — see effectiveAgentStatus().
    verificationStatus: {
      type: String,
      enum: ['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', null],
      default: null,
    },
    verified: { type: Boolean, default: false },
    // The agent's own KYC (registration + Profile > KYC documents). Photo
    // keys point at private Upload rows (Cloudinary `authenticated`); the
    // Aadhaar number is stored masked only, same as Vendor.kyc.
    kyc: {
      aadhaarNumberMasked: { type: String, default: null },
      // Full number, AES-256-GCM encrypted (lib/aadhaarVault.js). Admin only.
      aadhaarNumberEnc: { type: String, default: null },
      aadhaarName: { type: String, default: null },
      aadhaarPhotoKey: { type: String, default: null },
      panNumber: { type: String, default: null },
      panPhotoKey: { type: String, default: null },
      gstNumber: { type: String, default: null },
      gstPhotoKey: { type: String, default: null },
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

applyIdTransform(agentSchema);

const AgentModel = model('Agent', agentSchema);

function effectiveAgentStatus(agent) {
  return agent?.verificationStatus ?? 'ACTIVE';
}

module.exports = { AgentModel, bankAccountSchema, effectiveAgentStatus };
