const { Schema, model } = require('mongoose');
const { applyIdTransform } = require('./plugins');

const employeeSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    employeeId: { type: String, required: true, unique: true },
    referralCode: { type: String, required: true, unique: true },
    areaAssigned: { type: String, required: true },
    dailyTarget: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

applyIdTransform(employeeSchema);

const EmployeeModel = model('Employee', employeeSchema);

// Pre-issued verification codes — HR hands these out offline (ID card /
// joining letter). Seed via `npm run seed`.
const employeeVerificationSeedSchema = new Schema({
  code: { type: String, required: true, unique: true },
  employeeId: { type: String, required: true, unique: true },
  areaAssigned: { type: String, required: true },
  suggestedName: { type: String, required: true },
  used: { type: Boolean, default: false },
});

const EmployeeVerificationSeedModel = model(
  'EmployeeVerificationSeed',
  employeeVerificationSeedSchema,
);

// One row per user attributed to an employee's referral code — powers the
// dashboard totals, the date-filtered stats card, and the referral-users list.
const employeeReferralSchema = new Schema(
  {
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    userName: { type: String, required: true },
    userPhone: { type: String, required: true },
    role: { type: String, enum: ['customer', 'vendor', 'agent'], required: true },
    area: { type: String, default: null },
    status: { type: String, enum: ['ACTIVE', 'PENDING'], default: 'ACTIVE' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

applyIdTransform(employeeReferralSchema);

const EmployeeReferralModel = model('EmployeeReferral', employeeReferralSchema);

module.exports = { EmployeeModel, EmployeeVerificationSeedModel, EmployeeReferralModel };
