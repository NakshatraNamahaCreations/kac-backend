const { Schema, model } = require('mongoose');
const { applyIdTransform } = require('./plugins');

// One row per withdrawal a vendor / agent requests from their wallet.
// Payouts are manual: the coins are held (debited) when requested, an admin
// transfers the money from the bank and marks it PAID with the bank
// reference, or REJECTS it — which refunds the held coins to the wallet.
const withdrawalSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    amountCoins: { type: Number, required: true, min: 1 },
    // Snapshot of the payout account at request time, so a later bank edit
    // can't change where an already-requested payout goes.
    bank: {
      accountHolder: { type: String, required: true },
      accountNumberMasked: { type: String, required: true },
      // Full number, AES-256-GCM encrypted (lib/aadhaarVault.js). Admin only.
      accountNumberEnc: { type: String, default: null },
      ifsc: { type: String, required: true },
    },
    status: { type: String, enum: ['REQUESTED', 'PAID', 'REJECTED'], default: 'REQUESTED', index: true },
    // Bank transfer reference (UTR / IMPS ref) the admin enters when paying.
    payoutReference: { type: String, default: null },
    adminNote: { type: String, default: null },
    resolvedAt: { type: Date, default: null },
    ledgerEntryId: { type: Schema.Types.ObjectId, ref: 'LedgerEntry', default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

applyIdTransform(withdrawalSchema);
const WithdrawalModel = model('Withdrawal', withdrawalSchema);

module.exports = { WithdrawalModel };
