const { z } = require('zod');
const { isValidObjectId } = require('mongoose');
const { UserModel } = require('../models/User');
const { VendorModel } = require('../models/Vendor');
const { VendorPlanModel } = require('../models/VendorPlan');
const { CategoryModel } = require('../models/Category');
const { AgentModel } = require('../models/Agent');
const { EmployeeModel } = require('../models/Employee');
const { RefreshTokenModel } = require('../models/RefreshToken');
const { LedgerEntryModel } = require('../models/LedgerEntry');
const { normalizePhone } = require('../lib/phone');
const { agentReferralCode } = require('../lib/referralCode');
const { searchPlaces, placeDetails } = require('../lib/googlePlaces');
const { fail } = require('../lib/httpError');
const { assertOwnedUploads, publicUrlForOwnedKey } = require('./uploads.controller');

// Admin edit / delete / wallet adjust for the Users page. Ids are the same
// (role, id) pair listUsers / getUserDetail use: a User id for 'customer'
// (the All / Customers tabs), the role document's own id otherwise.

const text = (max) => z.string().trim().max(max).optional();
const phoneField = z
  .string()
  .trim()
  .refine((v) => v.replace(/\D+/g, '').length >= 10, 'Enter a 10-digit mobile number')
  .optional();
const pincodeField = z.string().trim().regex(/^\d{6}$/, 'Pincode must be 6 digits').or(z.literal('')).optional();

const bankSchema = z
  .object({
    accountHolder: z.string().trim().min(1).max(80),
    ifsc: z.string().trim().regex(/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/, 'Enter a valid IFSC (e.g. HDFC0001234)'),
    // Only sent when the account number itself changes; the stored copy is
    // masked, so an empty value keeps the existing one.
    accountNumber: z.string().trim().regex(/^\d{9,18}$/, 'Account number must be 9–18 digits').or(z.literal('')).optional(),
  })
  .optional();

const kycSchema = z
  .object({
    // Full 12 digits only when changing; stored masked. Empty keeps it.
    aadhaarNumber: z.string().trim().regex(/^\d{12}$/, 'Aadhaar must be 12 digits').or(z.literal('')).optional(),
    aadhaarName: text(80),
    panNumber: z.string().trim().regex(/^[A-Za-z]{5}\d{4}[A-Za-z]$/, 'PAN should look like ABCDE1234F').or(z.literal('')).optional(),
    gstNumber: z.string().trim().regex(/^[0-9A-Za-z]{15}$/, 'GST number must be 15 characters').or(z.literal('')).optional(),
    ownerName: text(80),
    establishedYear: z.string().trim().regex(/^\d{4}$/, 'Year must be 4 digits').or(z.literal('')).optional(),
    // Upload keys from POST /admin/uploads (uploaded on the user's behalf),
    // or null to clear the photo.
    aadhaarPhotoKey: z.string().nullable().optional(),
    panPhotoKey: z.string().nullable().optional(),
    gstPhotoKey: z.string().nullable().optional(),
  })
  .optional();

const editSchemas = {
  customer: z.object({
    name: text(80),
    phone: phoneField,
    language: z.enum(['en', 'ta', 'hi', 'kn', 'te', 'ml']).optional(),
    area: text(120),
    address: text(300),
  }),
  vendor: z.object({
    name: z.string().trim().min(1).max(120).optional(),
    personName: text(80),
    phone: phoneField,
    whatsapp: text(20),
    area: z.string().trim().min(1).max(160).optional(),
    address: text(300),
    addressPincode: pincodeField,
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    workingHours: text(120),
    bio: text(500),
    availability: z.enum(['ACTIVE', 'AWAY', 'BUSY']).optional(),
    categories: z.array(z.string().min(1)).min(1, 'Pick at least one category').max(10).optional(),
    // Offers / sub-services picked from the categories' tag lists.
    serviceTags: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
    // Cover photo: an upload key (kind 'shop' / 'profile' / 'gallery'
    // uploaded for this vendor), or null to remove it.
    coverPhotoKey: z.string().nullable().optional(),
    services: z
      .array(z.object({ name: z.string().trim().min(1).max(80), pricePaise: z.number().int().min(0).nullable() }))
      .max(20)
      .optional(),
    plan: z.string().min(1).optional(),
    serviceQuota: z.number().int().min(0).nullable().optional(),
    servicesUsed: z.number().int().min(0).optional(),
    bank: bankSchema,
    kyc: kycSchema,
  }),
  agent: z.object({
    name: text(80),
    phone: phoneField,
    area: text(160),
    address: text(300),
    bank: bankSchema,
    kyc: kycSchema,
  }),
  employee: z.object({
    name: text(80),
    phone: phoneField,
    address: text(300),
    areaAssigned: z.string().trim().min(1).max(160).optional(),
    dailyTarget: z.number().int().min(0).max(100000).optional(),
  }),
};

function assertRole(role) {
  if (!editSchemas[role]) fail(400, 'INVALID_ROLE', 'Unknown user type.');
}

function pick(obj, keys) {
  return Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
}

const maskAccount = (n) => `XXXX${n.replace(/\D+/g, '').slice(-4)}`;
const maskAadhaar = (n) => `XXXX XXXX ${n.replace(/\D+/g, '').slice(-4)}`;

// Changes a user's login phone: same +91XXXXXXXXXX format OTP login uses,
// must not belong to anyone else, mirrored onto their vendor profile, and
// signs them out so the next login uses the new number.
async function changePhone(userId, rawPhone) {
  if (rawPhone === undefined) return;
  const phone = normalizePhone(rawPhone);
  const user = await UserModel.findById(userId);
  if (!user || user.phone === phone) return;
  if (await UserModel.exists({ phone, _id: { $ne: userId } })) {
    fail(409, 'PHONE_TAKEN', 'Another account already uses this phone number.');
  }
  const oldPhone = user.phone;
  user.phone = phone;
  await user.save();
  const vendor = await VendorModel.findOne({ userId });
  if (vendor) {
    vendor.phone = phone;
    if (!vendor.whatsapp || vendor.whatsapp === oldPhone) vendor.whatsapp = phone;
    await vendor.save();
  }
  await RefreshTokenModel.deleteMany({ userId });
}

function applyKyc(existing, kyc, { withOwner }) {
  if (!kyc) return existing;
  const next = { ...(existing?.toObject?.() ?? existing ?? {}) };
  if (kyc.aadhaarNumber) next.aadhaarNumberMasked = maskAadhaar(kyc.aadhaarNumber);
  if (kyc.aadhaarName !== undefined) next.aadhaarName = kyc.aadhaarName || null;
  if (kyc.panNumber !== undefined) next.panNumber = kyc.panNumber ? kyc.panNumber.toUpperCase() : null;
  if (kyc.gstNumber !== undefined) next.gstNumber = kyc.gstNumber ? kyc.gstNumber.toUpperCase() : null;
  for (const k of ['aadhaarPhotoKey', 'panPhotoKey', 'gstPhotoKey']) {
    if (kyc[k] !== undefined) next[k] = kyc[k] || null;
  }
  if (withOwner) {
    if (kyc.ownerName !== undefined) next.ownerName = kyc.ownerName || null;
    if (kyc.establishedYear !== undefined) next.establishedYear = kyc.establishedYear || null;
  }
  return next;
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
    await changePhone(user._id, body.phone);
    await UserModel.updateOne({ _id: user._id }, { $set: pick(body, ['name', 'language', 'area', 'address']) });
    return res.json({ ok: true });
  }

  if (role === 'vendor') {
    const vendor = await VendorModel.findById(id);
    if (!vendor) fail(404, 'NOT_FOUND', 'Vendor not found.');

    if (body.categories) {
      const found = await CategoryModel.countDocuments({ _id: { $in: body.categories } });
      if (found !== new Set(body.categories).size) fail(400, 'INVALID_CATEGORY', 'One of the categories no longer exists.');
    }
    let planDoc = null;
    if (body.plan) {
      planDoc = await VendorPlanModel.findOne({ tier: body.plan });
      if (!planDoc) fail(400, 'INVALID_PLAN', 'That plan no longer exists.');
    }

    // Photos must belong to this vendor (admin uploads them on the vendor's
    // behalf), so their app can open them too.
    await assertOwnedUploads(vendor.userId, [
      body.kyc?.aadhaarPhotoKey,
      body.kyc?.panPhotoKey,
      body.kyc?.gstPhotoKey,
      body.coverPhotoKey,
    ]);
    let coverUrl;
    if (body.coverPhotoKey) {
      coverUrl = await publicUrlForOwnedKey(vendor.userId, body.coverPhotoKey);
      if (!coverUrl) fail(400, 'INVALID_UPLOAD', 'That cover photo is missing. Please upload it again.');
    }

    await changePhone(vendor.userId, body.phone);
    const fresh = await VendorModel.findById(id);
    if (body.serviceTags) fresh.serviceTags = body.serviceTags;
    if (coverUrl) fresh.photoUrl = coverUrl;
    else if (body.coverPhotoKey === null) fresh.photoUrl = null;

    Object.assign(
      fresh,
      pick(body, ['name', 'personName', 'whatsapp', 'area', 'address', 'addressPincode', 'workingHours', 'bio', 'availability', 'servicesUsed']),
    );
    if (body.lat !== undefined && body.lng !== undefined) fresh.geo = { lat: body.lat, lng: body.lng };
    if (body.categories) {
      fresh.categories = body.categories;
      if (!body.categories.includes(fresh.primaryCategoryId)) fresh.primaryCategoryId = body.categories[0];
    }
    if (body.services) fresh.services = body.services;
    if (planDoc) {
      fresh.plan = planDoc.tier;
      // Plan sets the job cap unless the admin set one explicitly.
      if (body.serviceQuota === undefined) fresh.serviceQuota = planDoc.serviceQuota;
    }
    if (body.serviceQuota !== undefined) fresh.serviceQuota = body.serviceQuota;
    if (body.bank) {
      fresh.bank = {
        accountHolder: body.bank.accountHolder,
        ifsc: body.bank.ifsc.toUpperCase(),
        accountNumberMasked: body.bank.accountNumber ? maskAccount(body.bank.accountNumber) : fresh.bank?.accountNumberMasked ?? null,
      };
    }
    if (body.kyc) fresh.kyc = applyKyc(fresh.kyc, body.kyc, { withOwner: true });
    await fresh.save();
    return res.json({ ok: true });
  }

  if (role === 'agent') {
    const agent = await AgentModel.findById(id);
    if (!agent) fail(404, 'NOT_FOUND', 'Agent not found.');
    await assertOwnedUploads(agent.userId, [body.kyc?.aadhaarPhotoKey, body.kyc?.panPhotoKey, body.kyc?.gstPhotoKey]);
    await changePhone(agent.userId, body.phone);
    if (body.area !== undefined) agent.area = body.area;
    if (body.bank) {
      // Agents can hold several payout accounts; the admin edits the
      // primary (first) one.
      const first = agent.bankAccounts[0];
      const masked = body.bank.accountNumber ? maskAccount(body.bank.accountNumber) : first?.accountNumberMasked;
      if (!masked) fail(400, 'ACCOUNT_REQUIRED', 'Enter the account number.');
      const acct = { accountHolder: body.bank.accountHolder, ifsc: body.bank.ifsc.toUpperCase(), accountNumberMasked: masked };
      if (first) Object.assign(first, acct);
      else agent.bankAccounts.push(acct);
    }
    if (body.kyc) agent.kyc = applyKyc(agent.kyc, body.kyc, { withOwner: false });
    await agent.save();
    await UserModel.updateOne({ _id: agent.userId }, { $set: pick(body, ['name', 'address', 'area']) });
    return res.json({ ok: true });
  }

  const employee = await EmployeeModel.findById(id);
  if (!employee) fail(404, 'NOT_FOUND', 'Employee not found.');
  await changePhone(employee.userId, body.phone);
  Object.assign(employee, pick(body, ['areaAssigned', 'dailyTarget']));
  await employee.save();
  await UserModel.updateOne({ _id: employee.userId }, { $set: pick(body, ['name', 'address']) });
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
//   vendor   — removes the vendor profile + role. Wallet is kept.
//   agent    — removes the agent role. Wallet / executive code kept.
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

// POST /admin/wallets/:userId/adjust { pool, coins, reason }
// Credits (coins > 0) or debits (coins < 0) a wallet with a ledger entry, so
// every balance change stays explained in the transaction history. Never
// takes a balance below zero.
const adjustSchema = z.object({
  pool: z.enum(['customer', 'agent']),
  coins: z.number().int().refine((n) => n !== 0, 'Enter a non-zero amount').refine((n) => Math.abs(n) <= 1000000),
  reason: z.string().trim().min(3, 'Add a short reason').max(120),
});

async function adjustWalletAdmin(req, res) {
  const { userId } = req.params;
  if (!isValidObjectId(userId)) fail(404, 'NOT_FOUND', 'User not found.');
  const { pool, coins, reason } = adjustSchema.parse(req.body);
  if (!(await UserModel.exists({ _id: userId }))) fail(404, 'NOT_FOUND', 'User not found.');

  let balance;
  if (pool === 'customer') {
    const updated = await UserModel.findOneAndUpdate(
      { _id: userId, ...(coins < 0 ? { walletCoins: { $gte: -coins } } : {}) },
      { $inc: { walletCoins: coins } },
      { new: true },
    );
    if (!updated) fail(400, 'INSUFFICIENT_BALANCE', "The wallet doesn't have that many coins.");
    balance = updated.walletCoins;
  } else {
    // Vendor / agent wallet — create it if this person was never credited.
    if (!(await AgentModel.exists({ userId }))) {
      await AgentModel.create({ userId, executiveCode: agentReferralCode(String(userId)), bankAccounts: [], walletCoins: 0 });
    }
    const updated = await AgentModel.findOneAndUpdate(
      { userId, ...(coins < 0 ? { walletCoins: { $gte: -coins } } : {}) },
      { $inc: { walletCoins: coins } },
      { new: true },
    );
    if (!updated) fail(400, 'INSUFFICIENT_BALANCE', "The wallet doesn't have that many coins.");
    balance = updated.walletCoins;
  }

  await LedgerEntryModel.create({
    pool,
    ownerId: userId,
    kind: coins > 0 ? 'credit' : 'debit',
    coins: Math.abs(coins),
    balance,
    description: `Admin adjustment — ${reason}`,
  });
  res.json({ ok: true, balance });
}

// GET /admin/places/search?q=&session=   GET /admin/places/:placeId?session=
async function searchPlacesAdmin(req, res) {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const session = typeof req.query.session === 'string' ? req.query.session : undefined;
  res.json({ data: await searchPlaces(q, session) });
}

async function placeDetailsAdmin(req, res) {
  const session = typeof req.query.session === 'string' ? req.query.session : undefined;
  res.json(await placeDetails(req.params.placeId, session));
}

module.exports = {
  updateUserAdmin,
  deleteUserAdmin,
  adjustWalletAdmin,
  searchPlacesAdmin,
  placeDetailsAdmin,
};
