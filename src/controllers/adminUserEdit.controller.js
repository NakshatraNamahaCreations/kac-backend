const { z } = require('zod');
const { isValidObjectId } = require('mongoose');
const { UserModel } = require('../models/User');
const { VendorModel } = require('../models/Vendor');
const { AgentModel } = require('../models/Agent');
const { EmployeeModel } = require('../models/Employee');
const { RefreshTokenModel } = require('../models/RefreshToken');
const { fail } = require('../lib/httpError');

// Admin edit / delete for the Users page. Ids are the same (role, id) pair
// listUsers / getUserDetail use: a User id for 'customer' (the All /
// Customers tabs), the role document's own id for vendor / agent / employee.
//
// Phone numbers are deliberately not editable — the phone IS the login
// (OTP) identity, and changing it here would orphan the account.

const optionalText = (max) => z.string().trim().max(max).optional();

const editSchemas = {
  customer: z.object({
    name: optionalText(80),
    area: optionalText(120),
    address: optionalText(300),
  }),
  vendor: z.object({
    name: z.string().trim().min(1).max(120).optional(), // business name
    personName: optionalText(80),
    area: z.string().trim().min(1).max(120).optional(),
    address: optionalText(300),
    addressPincode: z.string().trim().regex(/^\d{6}$/, 'Pincode must be 6 digits').or(z.literal('')).optional(),
    workingHours: optionalText(120),
    whatsapp: optionalText(20),
    bio: optionalText(500),
  }),
  agent: z.object({
    name: optionalText(80),
    area: optionalText(120),
    address: optionalText(300),
  }),
  employee: z.object({
    name: optionalText(80),
    areaAssigned: z.string().trim().min(1).max(120).optional(),
    dailyTarget: z.number().int().min(0).max(100000).optional(),
  }),
};

function assertRole(role) {
  if (!editSchemas[role]) fail(400, 'INVALID_ROLE', 'Unknown user type.');
}

function pick(obj, keys) {
  return Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
}

// PATCH /admin/users/:role/:id
async function updateUserAdmin(req, res) {
  const { role, id } = req.params;
  assertRole(role);
  if (!isValidObjectId(id)) fail(404, 'NOT_FOUND', 'User not found.');
  const body = editSchemas[role].parse(req.body);

  if (role === 'customer') {
    const user = await UserModel.findById(id);
    if (!user) fail(404, 'NOT_FOUND', 'User not found.');
    Object.assign(user, pick(body, ['name', 'area', 'address']));
    await user.save();
    return res.json({ ok: true });
  }

  if (role === 'vendor') {
    const vendor = await VendorModel.findById(id);
    if (!vendor) fail(404, 'NOT_FOUND', 'Vendor not found.');
    Object.assign(
      vendor,
      pick(body, ['name', 'personName', 'area', 'address', 'addressPincode', 'workingHours', 'whatsapp', 'bio']),
    );
    await vendor.save();
    return res.json({ ok: true });
  }

  if (role === 'agent') {
    const agent = await AgentModel.findById(id);
    if (!agent) fail(404, 'NOT_FOUND', 'Agent not found.');
    if (body.area !== undefined) agent.area = body.area;
    await agent.save();
    await UserModel.updateOne({ _id: agent.userId }, { $set: pick(body, ['name', 'address', 'area']) });
    return res.json({ ok: true });
  }

  // employee
  const employee = await EmployeeModel.findById(id);
  if (!employee) fail(404, 'NOT_FOUND', 'Employee not found.');
  Object.assign(employee, pick(body, ['areaAssigned', 'dailyTarget']));
  await employee.save();
  if (body.name !== undefined) await UserModel.updateOne({ _id: employee.userId }, { $set: { name: body.name } });
  return res.json({ ok: true });
}

async function removeRole(userId, role) {
  await UserModel.updateOne({ _id: userId }, { $pull: { roles: role } });
  // Sign them out everywhere — their next token refresh fails and the app
  // returns to login, instead of carrying on in a role they no longer have.
  await RefreshTokenModel.deleteMany({ userId });
}

// DELETE /admin/users/:role/:id
//   customer — deletes the whole account (every role, profile documents,
//              sessions). Bookings and payments stay as history.
//   vendor   — removes the vendor profile + role. Their wallet (balance,
//              transactions) is kept.
//   agent    — removes the agent role. The wallet / executive code are kept
//              so earned coins aren't destroyed; re-registering restores it.
//   employee — removes the employee record + role.
async function deleteUserAdmin(req, res) {
  const { role, id } = req.params;
  assertRole(role);
  if (!isValidObjectId(id)) fail(404, 'NOT_FOUND', 'User not found.');

  if (role === 'customer') {
    const user = await UserModel.findById(id);
    if (!user) fail(404, 'NOT_FOUND', 'User not found.');
    await Promise.all([
      VendorModel.deleteOne({ userId: user._id }),
      AgentModel.deleteOne({ userId: user._id }),
      EmployeeModel.deleteOne({ userId: user._id }),
      RefreshTokenModel.deleteMany({ userId: user._id }),
    ]);
    await UserModel.deleteOne({ _id: user._id });
    return res.json({ ok: true, deleted: 'account' });
  }

  if (role === 'vendor') {
    const vendor = await VendorModel.findById(id);
    if (!vendor) fail(404, 'NOT_FOUND', 'Vendor not found.');
    await VendorModel.deleteOne({ _id: vendor._id });
    await removeRole(vendor.userId, 'vendor');
    return res.json({ ok: true, deleted: 'vendor' });
  }

  if (role === 'agent') {
    const agent = await AgentModel.findById(id);
    if (!agent) fail(404, 'NOT_FOUND', 'Agent not found.');
    await removeRole(agent.userId, 'agent');
    return res.json({ ok: true, deleted: 'agent' });
  }

  const employee = await EmployeeModel.findById(id);
  if (!employee) fail(404, 'NOT_FOUND', 'Employee not found.');
  await EmployeeModel.deleteOne({ _id: employee._id });
  await removeRole(employee.userId, 'employee');
  return res.json({ ok: true, deleted: 'employee' });
}

module.exports = { updateUserAdmin, deleteUserAdmin };
