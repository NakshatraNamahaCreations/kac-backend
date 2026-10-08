// Every response DTO on the mobile app uses a string `id` field, not Mongo's
// `_id`/`__v`. Apply this to every schema so `.toJSON()` output matches the
// client's types without per-controller mapping.
function applyIdTransform(schema) {
  schema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform: (_doc, ret) => {
      ret.id = String(ret._id);
      delete ret._id;
      // Encrypted full Aadhaar never leaves the server in API responses —
      // only the admin panel gets it, decrypted, explicitly.
      if (ret.kyc && typeof ret.kyc === 'object') delete ret.kyc.aadhaarNumberEnc;
      // Same for full bank account numbers (Vendor.bank, Agent bank subdocs).
      if (ret.bank && typeof ret.bank === 'object') delete ret.bank.accountNumberEnc;
      if (Array.isArray(ret.bankAccounts)) ret.bankAccounts.forEach((b) => b && delete b.accountNumberEnc);
      delete ret.accountNumberEnc;
    },
  });
}

module.exports = { applyIdTransform };
