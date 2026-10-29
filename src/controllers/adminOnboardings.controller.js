const { OnboardingModel } = require('../models/Onboarding');
const { UserModel } = require('../models/User');
const { AgentModel } = require('../models/Agent');
const { VendorModel } = require('../models/Vendor');
const { buildPage, parseCursor } = require('../lib/pagination');

const PAGE_LIMIT = 25;

// Everything an agent recorded when onboarding a vendor in person — the same
// shape the agent detail's "Vendors onboarded" list uses (admin.controller.js).
function onboardingDto(o) {
  return {
    id: String(o._id),
    createdAt: o.createdAt,
    status: o.status,
    plan: o.plan,
    prepaid: o.prepaid,
    prepaidUsed: o.prepaidUsed,
    vendorName: o.vendorName,
    businessName: o.businessName ?? null,
    ownerName: o.ownerName ?? null,
    vendorPhone: o.vendorPhone,
    area: o.area ?? null,
    aadhaarNumber: o.aadhaarNumber ?? null,
    aadhaarNumberMasked: o.aadhaarNumber ? `XXXX XXXX ${String(o.aadhaarNumber).slice(-4)}` : null,
    aadhaarName: o.aadhaarName ?? null,
    panNumber: o.panNumber ?? null,
    gstNumber: o.gstNumber ?? null,
    establishedYear: o.establishedYear ?? null,
    aadhaarPhotoKey: o.aadhaarPhotoKey ?? null,
    panPhotoKey: o.panPhotoKey ?? null,
    gstPhotoKey: o.gstPhotoKey ?? null,
    shopPhotoKey: o.shopPhotoKey ?? null,
    earningsCoins: o.earningsCoins,
  };
}

// GET /admin/onboardings?status=PENDING|ACTIVE — every vendor an agent
// onboarded in person. A PENDING one has no Vendor record yet (the vendor
// hasn't logged in to finish), so it never shows in Users > Vendors; this is
// where the admin sees it. First page also carries `pendingCount`.
async function listOnboardingsAdmin(req, res) {
  const status = req.query.status === 'PENDING' || req.query.status === 'ACTIVE' ? req.query.status : null;
  const filter = status ? { status } : {};
  const skip = parseCursor(typeof req.query.cursor === 'string' ? req.query.cursor : undefined);
  const [total, rows, pendingCount] = await Promise.all([
    OnboardingModel.countDocuments(filter),
    OnboardingModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(PAGE_LIMIT),
    OnboardingModel.countDocuments({ status: 'PENDING' }),
  ]);
  const agentIds = rows.map((o) => o.agentId);
  const [agentUsers, agents, vendors] = await Promise.all([
    UserModel.find({ _id: { $in: agentIds } }, 'name phone'),
    AgentModel.find({ userId: { $in: agentIds } }, 'userId executiveCode'),
    VendorModel.find({ phone: { $in: rows.map((o) => o.vendorPhone) } }, 'phone name verificationStatus'),
  ]);
  const userById = new Map(agentUsers.map((u) => [String(u._id), u]));
  const codeByUser = new Map(agents.map((a) => [String(a.userId), a.executiveCode]));
  const vendorByPhone = new Map(vendors.map((v) => [v.phone, v]));

  const data = rows.map((o) => {
    const agent = userById.get(String(o.agentId));
    const vendor = vendorByPhone.get(o.vendorPhone);
    return {
      ...onboardingDto(o),
      agent: {
        name: agent?.name ?? null,
        phone: agent?.phone ?? null,
        code: codeByUser.get(String(o.agentId)) ?? null,
      },
      // Set once the vendor has logged in and finished registration.
      vendorRecord: vendor
        ? { id: String(vendor._id), name: vendor.name, verificationStatus: vendor.verificationStatus }
        : null,
    };
  });
  res.json({ ...buildPage(data, skip, PAGE_LIMIT, total), total, pendingCount });
}

module.exports = { listOnboardingsAdmin, onboardingDto };
