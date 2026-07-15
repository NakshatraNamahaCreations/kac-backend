require('dotenv/config');
const { connectDb } = require('../db/connect');
const { CategoryModel } = require('../models/Category');
const { EmployeeVerificationSeedModel } = require('../models/Employee');
const { categories } = require('./categories.data');

const EMPLOYEE_VERIFICATION_SEEDS = [
  { code: 'GK-EMP-1001', employeeId: 'EMP-1001', suggestedName: 'Rohit Kumar', areaAssigned: 'Bengaluru — South' },
  { code: 'GK-EMP-1002', employeeId: 'EMP-1002', suggestedName: 'Priya Sharma', areaAssigned: 'Bengaluru — East' },
  { code: 'GK-EMP-1003', employeeId: 'EMP-1003', suggestedName: 'Aman Verma', areaAssigned: 'Bengaluru — North' },
];

async function seed() {
  await connectDb();

  for (const c of categories) {
    await CategoryModel.updateOne({ _id: c.id }, { $set: { ...c, _id: c.id } }, { upsert: true });
  }
  console.log(`[seed] upserted ${categories.length} categories`);

  for (const s of EMPLOYEE_VERIFICATION_SEEDS) {
    await EmployeeVerificationSeedModel.updateOne({ code: s.code }, { $set: s }, { upsert: true });
  }
  console.log(`[seed] upserted ${EMPLOYEE_VERIFICATION_SEEDS.length} employee verification codes`);

  process.exit(0);
}

seed().catch((err) => {
  console.error('[seed] failed', err);
  process.exit(1);
});
