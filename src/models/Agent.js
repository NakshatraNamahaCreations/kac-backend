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
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

applyIdTransform(agentSchema);

const AgentModel = model('Agent', agentSchema);

module.exports = { AgentModel, bankAccountSchema };
