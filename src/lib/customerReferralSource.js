const { UserModel } = require('../models/User');
const { EmployeeReferralModel } = require('../models/Employee');
const { VendorReferralModel } = require('../models/VendorReferral');
const { CustomerReferralModel } = require('../models/CustomerReferral');

// Who referred each customer signup (admin Users > Customers "Referred by"
// filter), from the records written when the customer role is added:
//   employee code -> EmployeeReferral (role 'customer')
//   vendor code   -> VendorReferral (referredRole 'customer')
//   agent code    -> CustomerReferral (referrerRole 'agent')
//   customer code -> CustomerReferral (referrerRole 'customer' / unset)
// A customer is credited to ONE source, priority employee > vendor > agent
// > customer (same order as the payments report).
const TYPES = ['employee', 'vendor', 'agent', 'customer'];

async function referredCustomerIds() {
  const [emp, ven, cust] = await Promise.all([
    EmployeeReferralModel.find({ role: 'customer' }, 'userId'),
    VendorReferralModel.find({ referredRole: 'customer' }, 'referredPhone'),
    CustomerReferralModel.find({}, 'referredId referrerRole'),
  ]);
  const venUsers = ven.length
    ? await UserModel.find({ phone: { $in: ven.map((r) => r.referredPhone) } }, '_id')
    : [];
  const ids = {
    employee: new Set(emp.map((r) => String(r.userId))),
    vendor: new Set(venUsers.map((u) => String(u._id))),
    agent: new Set(cust.filter((r) => r.referrerRole === 'agent').map((r) => String(r.referredId))),
    customer: new Set(cust.filter((r) => r.referrerRole !== 'agent').map((r) => String(r.referredId))),
  };
  // Apply the priority so each customer sits in exactly one set.
  const taken = new Set();
  for (const t of TYPES) {
    ids[t] = new Set([...ids[t]].filter((id) => !taken.has(id)));
    ids[t].forEach((id) => taken.add(id));
  }
  return { ids, all: taken };
}

// Mongo filter on User._id for a "referred by" value, or null if unknown.
// 'none' = customers who signed up without any referral code.
async function customerSourceFilter(type) {
  if (!TYPES.includes(type) && type !== 'none') return null;
  const { ids, all } = await referredCustomerIds();
  if (type === 'none') return { _id: { $nin: [...all] } };
  return { _id: { $in: [...ids[type]] } };
}

// userId -> referrer type, for labelling a page of customer rows.
async function customerSourceByUser() {
  const { ids } = await referredCustomerIds();
  const out = new Map();
  for (const t of TYPES) ids[t].forEach((id) => out.set(id, t));
  return out;
}

module.exports = { customerSourceFilter, customerSourceByUser };
