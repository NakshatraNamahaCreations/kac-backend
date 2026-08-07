const { Schema, model } = require('mongoose');
const { applyIdTransform } = require('./plugins');

// Admin login is normally env-var based (see config/env.js's adminUsername/
// adminPasswordHash) so a fresh deploy always has a working login without
// touching the database. This collection is the DB-backed alternative —
// once a row exists here, adminLogin checks it first (env vars stay as an
// emergency fallback). Bootstrapped via POST /admin/setup, which refuses to
// run a second time once any row exists here — see admin.controller.js.
const adminSchema = new Schema(
  {
    username: { type: String, required: true, unique: true, index: true },
    passwordHash: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: true } },
);

applyIdTransform(adminSchema);
const AdminModel = model('Admin', adminSchema);

module.exports = { AdminModel };
