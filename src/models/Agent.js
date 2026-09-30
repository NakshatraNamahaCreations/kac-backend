const { Schema, model } = require('mongoose');
const { applyIdTransform } = require('./plugins');

const bankAccountSchema = new Schema(
  {
    accountHolder: { type: String, required: true },
    accountNumberMasked: { type: String, required: true },
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
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

applyIdTransform(agentSchema);

const AgentModel = model('Agent', agentSchema);

function effectiveAgentStatus(agent) {
  return agent?.verificationStatus ?? 'ACTIVE';
}

module.exports = { AgentModel, bankAccountSchema, effectiveAgentStatus };
