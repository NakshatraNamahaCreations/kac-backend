const { z } = require('zod');
const { isValidObjectId } = require('mongoose');
const { VendorModel } = require('../models/Vendor');
const { AgentModel } = require('../models/Agent');
const { OnboardingModel } = require('../models/Onboarding');
const { UserModel } = require('../models/User');
const {
  ChangeRequestModel,
  CHANGE_REQUEST_CATEGORIES,
  CHANGE_REQUEST_STATUSES,
} = require('../models/ChangeRequest');
const { decryptSecret } = require('../lib/aadhaarVault');
const { fail } = require('../lib/httpError');
const { buildPage, parseCursor } = require('../lib/pagination');
const { io } = require('../realtime/socket');

const roleQuery = z.enum(['vendor', 'agent']);

// GET /me/kyc-details?role=vendor|agent — the signed-in vendor / agent's OWN
// bank + KYC details in full (Aadhaar and account numbers decrypted), for the
// view-only screens in the app. Never anyone else's: always req.user.
async function getMyKycDetails(req, res) {
  const role = roleQuery.parse(req.query.role);
  if (!req.user.roles.includes(role)) fail(403, 'ROLE_REQUIRED', `You are not registered as a ${role}.`);
  const userId = req.user._id;

  let kyc = {};
  let banks = [];
  if (role === 'vendor') {
    const vendor = await VendorModel.findOne({ userId });
    if (!vendor) fail(404, 'VENDOR_NOT_FOUND', 'You have not registered as a vendor yet.');
    kyc = vendor.kyc ?? {};
    let aadhaarNumber = decryptSecret(kyc.aadhaarNumberEnc);
    if (!aadhaarNumber) {
      // Vendors onboarded in person before encryption existed.
      const ob = await OnboardingModel.findOne(
        { vendorPhone: vendor.phone, aadhaarNumber: { $nin: [null, ''] } },
        'aadhaarNumber',
      ).sort({ createdAt: -1 });
      aadhaarNumber = ob?.aadhaarNumber ?? null;
    }
    kyc = { ...(kyc.toObject?.() ?? kyc), aadhaarNumber };
    if (vendor.bank?.accountNumberMasked) {
      banks = [
        {
          id: 'primary',
          accountHolder: vendor.bank.accountHolder,
          ifsc: vendor.bank.ifsc,
          accountNumber: decryptSecret(vendor.bank.accountNumberEnc),
          accountNumberMasked: vendor.bank.accountNumberMasked,
        },
      ];
    }
  } else {
    const agent = await AgentModel.findOne({ userId });
    if (!agent) fail(404, 'AGENT_NOT_FOUND', 'You have not registered as an agent yet.');
    kyc = { ...(agent.kyc?.toObject?.() ?? agent.kyc ?? {}), aadhaarNumber: decryptSecret(agent.kyc?.aadhaarNumberEnc) };
    banks = agent.bankAccounts.map((b) => ({
      id: String(b._id),
      accountHolder: b.accountHolder,
      ifsc: b.ifsc,
      accountNumber: decryptSecret(b.accountNumberEnc),
      accountNumberMasked: b.accountNumberMasked,
    }));
  }

  res.json({
    role,
    kyc: {
      aadhaarNumber: kyc.aadhaarNumber ?? null,
      aadhaarNumberMasked: kyc.aadhaarNumberMasked ?? null,
      aadhaarName: kyc.aadhaarName ?? null,
      aadhaarPhotoUploaded: !!kyc.aadhaarPhotoKey,
      panNumber: kyc.panNumber ?? null,
      panPhotoUploaded: !!kyc.panPhotoKey,
      gstNumber: kyc.gstNumber ?? null,
      gstPhotoUploaded: !!kyc.gstPhotoKey,
    },
    banks,
    upiNumber: req.user.upiNumber ?? null,
  });
}

const createSchema = z.object({
  role: roleQuery,
  category: z.enum(CHANGE_REQUEST_CATEGORIES),
  message: z.string().trim().min(5, 'Tell us what needs to change (at least a few words).').max(1000),
});

// POST /me/change-requests — ask the GigKaar team to change bank / KYC / UPI.
async function createChangeRequest(req, res) {
  const body = createSchema.parse(req.body);
  if (!req.user.roles.includes(body.role)) fail(403, 'ROLE_REQUIRED', `You are not registered as a ${body.role}.`);
  const open = await ChangeRequestModel.countDocuments({ userId: req.user._id, status: { $in: ['OPEN', 'IN_PROGRESS'] } });
  if (open >= 5) fail(429, 'TOO_MANY_OPEN', 'You already have 5 open requests. Please wait for the team to respond.');
  const row = await ChangeRequestModel.create({
    userId: req.user._id,
    ...body,
    history: [{ status: 'OPEN', note: null, at: new Date() }],
  });
  res.status(201).json(row.toJSON());
}

// GET /me/change-requests?role= — the user's own requests, newest first.
async function listMyChangeRequests(req, res) {
  const filter = { userId: req.user._id };
  if (req.query.role === 'vendor' || req.query.role === 'agent') filter.role = req.query.role;
  const rows = await ChangeRequestModel.find(filter).sort({ createdAt: -1 }).limit(30);
  res.json({ data: rows.map((r) => r.toJSON()) });
}

// ---- Admin ----

const PAGE_LIMIT = 25;

// GET /admin/change-requests?status=
async function listChangeRequestsAdmin(req, res) {
  const status = CHANGE_REQUEST_STATUSES.includes(req.query.status) ? req.query.status : null;
  const filter = status ? { status } : {};
  const skip = parseCursor(typeof req.query.cursor === 'string' ? req.query.cursor : undefined);
  const [total, rows, openCount] = await Promise.all([
    ChangeRequestModel.countDocuments(filter),
    ChangeRequestModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(PAGE_LIMIT),
    ChangeRequestModel.countDocuments({ status: { $in: ['OPEN', 'IN_PROGRESS'] } }),
  ]);
  const users = await UserModel.find({ _id: { $in: rows.map((r) => r.userId) } }, 'name phone roles');
  const userById = new Map(users.map((u) => [String(u._id), u]));
  const data = rows.map((r) => {
    const u = userById.get(String(r.userId));
    return {
      ...r.toJSON(),
      userId: String(r.userId),
      user: u ? { name: u.name, phone: u.phone, roles: u.roles } : null,
    };
  });
  res.json({ ...buildPage(data, skip, PAGE_LIMIT, total), total, openCount });
}

const updateSchema = z.object({
  status: z.enum(CHANGE_REQUEST_STATUSES),
  adminNote: z.string().trim().max(500).optional(),
});

// PATCH /admin/change-requests/:id { status, adminNote }
async function updateChangeRequestAdmin(req, res) {
  if (!isValidObjectId(req.params.id)) fail(404, 'NOT_FOUND', 'Request not found.');
  const body = updateSchema.parse(req.body);
  const row = await ChangeRequestModel.findById(req.params.id);
  if (!row) fail(404, 'NOT_FOUND', 'Request not found.');
  const note = body.adminNote !== undefined ? body.adminNote || null : row.adminNote;
  // Requests from before history existed start their timeline at creation.
  if (row.history.length === 0) row.history.push({ status: 'OPEN', note: null, at: row.createdAt });
  if (body.status !== row.status || note !== row.adminNote) {
    row.history.push({ status: body.status, note, at: new Date() });
  }
  row.status = body.status;
  row.adminNote = note;
  row.resolvedAt = body.status === 'RESOLVED' || body.status === 'REJECTED' ? new Date() : null;
  await row.save();
  io()?.to(`user:${String(row.userId)}`).emit('changeRequest.updated', { id: String(row._id), status: row.status });
  res.json(row.toJSON());
}

module.exports = {
  getMyKycDetails,
  createChangeRequest,
  listMyChangeRequests,
  listChangeRequestsAdmin,
  updateChangeRequestAdmin,
};
