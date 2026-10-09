const { Schema, model } = require('mongoose');
const { applyIdTransform } = require('./plugins');

const employeeSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    employeeId: { type: String, required: true, unique: true },
    referralCode: { type: String, required: true, unique: true },
    areaAssigned: { type: String, required: true },
    // Total daily registrations target. Kept as the sum of dailyTargets
    // (setDailyTargets) so older app builds that only read `target` still work.
    dailyTarget: { type: Number, default: 0 },
    // Per-role daily registration targets, set by the admin.
    dailyTargets: {
      customer: { type: Number, default: 0 },
      vendor: { type: Number, default: 0 },
      agent: { type: Number, default: 0 },
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

applyIdTransform(employeeSchema);

const EmployeeModel = model('Employee', employeeSchema);

// Sets the per-role targets and keeps dailyTarget = their sum.
function setDailyTargets(employee, targets) {
  const t = {
    customer: targets?.customer ?? 0,
    vendor: targets?.vendor ?? 0,
    agent: targets?.agent ?? 0,
  };
  employee.dailyTargets = t;
  employee.dailyTarget = t.customer + t.vendor + t.agent;
}

// Targets as the dashboards read them. Employees created before per-role
// targets only have a total, so `total` falls back to dailyTarget.
function dailyTargetsOf(employee) {
  const t = employee.dailyTargets ?? {};
  const customer = t.customer ?? 0;
  const vendor = t.vendor ?? 0;
  const agent = t.agent ?? 0;
  const sum = customer + vendor + agent;
  return { customer, vendor, agent, total: sum || employee.dailyTarget || 0 };
}

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

module.exports = {
  EmployeeModel,
  EmployeeVerificationSeedModel,
  EmployeeReferralModel,
  setDailyTargets,
  dailyTargetsOf,
};
