const { Schema, model } = require('mongoose');
const { applyIdTransform } = require('./plugins');

const ledgerEntrySchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    kind: { type: String, enum: ['credit', 'debit'], required: true },
    coins: { type: Number, required: true },
    balance: { type: Number, required: true },
    description: { type: String, required: true },
    onboardingId: { type: Schema.Types.ObjectId, ref: 'Onboarding', default: null },
    withdrawalId: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

applyIdTransform(ledgerEntrySchema);

const LedgerEntryModel = model('LedgerEntry', ledgerEntrySchema);

module.exports = { LedgerEntryModel };
