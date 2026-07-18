const { z } = require('zod');
const { VendorModel } = require('../models/Vendor');
const { BookingModel } = require('../models/Booking');
const { EmployeeModel, EmployeeReferralModel } = require('../models/Employee');
const { fail } = require('../lib/httpError');
const { detectReferralKind } = require('../lib/referralCode');
const { servicesForCategories } = require('../lib/categoryServices');
const { creditOnboardingForVendorPhone, creditReferralCodeForAgent } = require('./agent.controller');

const serviceSchema = z.object({
  name: z.string().min(1),
  pricePaise: z.number().int().positive(),
});

// Only the masked form is ever persisted — mirrors wallet.controller.js's
// addBankAccount, which does the same for agent payout accounts.
function maskAccountNumber(accountNumber) {
  const digits = accountNumber.replace(/\D+/g, '');
  return `XXXX${digits.slice(-4)}`;
}
function maskAadhaar(aadhaarNumber) {
  const digits = aadhaarNumber.replace(/\D+/g, '');
  return `XXXX XXXX ${digits.slice(-4)}`;
}

const registerSchema = z.object({
  categories: z.array(z.string()).min(1),
  // Vendor-defined services (own name + price). Falls back to a generic
  // catalog per category if omitted, for backward compatibility with
  // clients that haven't picked up the dynamic-services wizard step yet.
  services: z.array(serviceSchema).optional(),
  area: z.string(),
  hours: z.string(),
  photoKey: z.string().optional(),
  idDocKey: z.string().optional(),
  bank: z.object({ accountNumber: z.string(), ifsc: z.string(), accountHolder: z.string() }),
  personName: z.string().optional(),
  businessName: z.string().optional(),
  address: z.string().optional(),
  addressPincode: z.string().optional(),
  locationLat: z.number().optional(),
  locationLng: z.number().optional(),
  plan: z.enum(['BASIC', 'PRO']).optional(),
  referralCode: z.string().optional(),
  // KYC — the wizard collects these on StepDocs but the schema previously
  // omitted them, so Zod silently stripped them before they ever reached
  // the database.
  aadhaarNumber: z.string().optional(),
  aadhaarName: z.string().optional(),
  aadhaarPhotoKey: z.string().optional(),
  panNumber: z.string().optional(),
  panPhotoKey: z.string().optional(),
  gstNumber: z.string().optional(),
  gstPhotoKey: z.string().optional(),
  ownerName: z.string().optional(),
  establishedYear: z.string().optional(),
});

async function registerVendor(req, res) {
  const body = registerSchema.parse(req.body);
  const user = req.user;

  let vendor = await VendorModel.findOne({ userId: user._id });
  if (vendor) fail(409, 'ALREADY_REGISTERED', 'You have already registered as a vendor.');

  vendor = await VendorModel.create({
    userId: user._id,
    name: body.businessName ?? user.name ?? 'Your business',
    primaryCategoryId: body.categories[0],
    categories: body.categories,
    services:
      body.services && body.services.length > 0
        ? body.services
        : servicesForCategories(body.categories),
    area: body.area,
    photoUrl: body.photoKey ? `https://picsum.photos/seed/${body.photoKey}/400/400` : null,
    bio: 'New on GigKaar.',
    workingHours: body.hours,
    phone: user.phone,
    whatsapp: user.phone,
    geo:
      body.locationLat != null && body.locationLng != null
        ? { lat: body.locationLat, lng: body.locationLng }
        : { lat: 12.9716, lng: 77.5946 },
    personName: body.personName ?? user.name ?? undefined,
    address: body.address,
    addressPincode: body.addressPincode,
    plan: body.plan ?? 'BASIC',
    serviceQuota: body.plan === 'PRO' ? null : 10,
    servicesUsed: 0,
    verificationStatus: 'PENDING_PAYMENT',
    bank: {
      accountHolder: body.bank.accountHolder,
      accountNumberMasked: maskAccountNumber(body.bank.accountNumber),
      ifsc: body.bank.ifsc.toUpperCase(),
    },
    kyc: {
      aadhaarNumberMasked: body.aadhaarNumber ? maskAadhaar(body.aadhaarNumber) : null,
      aadhaarName: body.aadhaarName ?? null,
      aadhaarPhotoKey: body.aadhaarPhotoKey ?? null,
      panNumber: body.panNumber ?? null,
      panPhotoKey: body.panPhotoKey ?? null,
      gstNumber: body.gstNumber ?? null,
      gstPhotoKey: body.gstPhotoKey ?? null,
      ownerName: body.ownerName ?? null,
      establishedYear: body.establishedYear ?? null,
    },
  });

  if (!user.roles.includes('vendor')) {
    user.roles.push('vendor');
    await user.save();
  }

  if (body.referralCode) {
    const kind = detectReferralKind(body.referralCode);
    if (kind === 'employee') {
      const employee = await EmployeeModel.findOne({ referralCode: body.referralCode.trim().toUpperCase() });
      if (employee) {
        await EmployeeReferralModel.create({
          employeeId: employee._id,
          userId: user._id,
          userName: vendor.name,
          userPhone: user.phone,
          role: 'vendor',
          area: vendor.area,
        });
      }
    }
  }

  // If an agent onboarded this phone number earlier, this registration is
  // the real-world event that earns them their cashback. If not, but this
  // vendor typed an agent's code directly (no pre-registration), credit
  // that agent instead — same cashback, different attribution path.
  const creditedByPhone = await creditOnboardingForVendorPhone(user.phone, vendor.name);
  if (!creditedByPhone && body.referralCode && detectReferralKind(body.referralCode) === 'agent') {
    await creditReferralCodeForAgent(body.referralCode, vendor.name, user.phone);
  }

  res.status(201).json({ vendorId: String(vendor._id), status: 'PENDING_PAYMENT' });
}

async function requireOwnVendor(req) {
  const vendor = await VendorModel.findOne({ userId: req.user._id });
  if (!vendor) fail(404, 'VENDOR_NOT_FOUND', 'You have not registered as a vendor yet.');
  return vendor;
}

async function getMyVendor(req, res) {
  const vendor = await requireOwnVendor(req);
  res.json(vendor.toJSON());
}

const patchVendorSchema = z.object({
  name: z.string().optional(),
  bio: z.string().optional(),
  workingHours: z.string().optional(),
  whatsapp: z.string().nullable().optional(),
  photos: z.array(z.string()).optional(),
  photoCaptions: z.record(z.string()).optional(),
  serviceTags: z.array(z.string()).optional(),
  personName: z.string().optional(),
  address: z.string().optional(),
  area: z.string().optional(),
  categories: z.array(z.string()).optional(),
  // Vendor-defined services for a newly-added category (own name + price).
  // Falls back to the generic catalog if omitted.
  services: z.array(serviceSchema).optional(),
  // Bank account edits (BankAccountScreen/AddBankAccountScreen) — raw
  // accountNumber in, masked form persisted, same as registration.
  bank: z.object({ accountNumber: z.string(), ifsc: z.string(), accountHolder: z.string() }).optional(),
  // KYC edits (DocumentsScreen).
  aadhaarNumber: z.string().optional(),
  aadhaarName: z.string().optional(),
  aadhaarPhotoKey: z.string().optional(),
  panNumber: z.string().optional(),
  panPhotoKey: z.string().optional(),
  gstNumber: z.string().optional(),
  gstPhotoKey: z.string().optional(),
  ownerName: z.string().optional(),
  establishedYear: z.string().optional(),
  // Profile photo reupload (DocumentsScreen) — was previously accepted only
  // at registration time via photoKey; there was no way to change it after.
  photoKey: z.string().optional(),
});

async function patchMyVendor(req, res) {
  const {
    categories,
    services,
    bank,
    aadhaarNumber,
    aadhaarName,
    aadhaarPhotoKey,
    panNumber,
    panPhotoKey,
    gstNumber,
    gstPhotoKey,
    ownerName,
    establishedYear,
    photoKey,
    ...rest
  } = patchVendorSchema.parse(req.body);
  const vendor = await requireOwnVendor(req);

  if (photoKey) {
    vendor.photoUrl = `https://picsum.photos/seed/${photoKey}/400/400`;
  }

  if (bank) {
    vendor.bank = {
      accountHolder: bank.accountHolder,
      accountNumberMasked: maskAccountNumber(bank.accountNumber),
      ifsc: bank.ifsc.toUpperCase(),
    };
  }

  const kycPatch = {
    ...(aadhaarNumber !== undefined ? { aadhaarNumberMasked: maskAadhaar(aadhaarNumber) } : {}),
    ...(aadhaarName !== undefined ? { aadhaarName } : {}),
    ...(aadhaarPhotoKey !== undefined ? { aadhaarPhotoKey } : {}),
    ...(panNumber !== undefined ? { panNumber } : {}),
    ...(panPhotoKey !== undefined ? { panPhotoKey } : {}),
    ...(gstNumber !== undefined ? { gstNumber } : {}),
    ...(gstPhotoKey !== undefined ? { gstPhotoKey } : {}),
    ...(ownerName !== undefined ? { ownerName } : {}),
    ...(establishedYear !== undefined ? { establishedYear } : {}),
  };
  if (Object.keys(kycPatch).length > 0) {
    vendor.kyc = { ...(vendor.kyc?.toObject?.() ?? vendor.kyc ?? {}), ...kycPatch };
  }

  // A paid "add service" purchase PATCHes the full updated categories list
  // plus the vendor's own name+price for the new service(s). Falls back to
  // the generic catalog only if the client didn't send any (older clients).
  if (categories) {
    const existing = new Set(vendor.categories);
    const added = categories.filter((c) => !existing.has(c));
    if (services && services.length > 0) {
      vendor.services.push(...services);
    } else if (added.length > 0) {
      vendor.services.push(...servicesForCategories(added));
    }
    vendor.categories = categories;
  }

  Object.assign(vendor, rest);
  await vendor.save();
  res.json(vendor.toJSON());
}

const availabilitySchema = z.object({ status: z.enum(['ACTIVE', 'AWAY', 'BUSY']) });

async function patchMyAvailability(req, res) {
  const { status } = availabilitySchema.parse(req.body);
  const vendor = await requireOwnVendor(req);
  vendor.availability = status;
  await vendor.save();
  res.json(vendor.toJSON());
}

async function getMyAnalytics(req, res) {
  const vendor = await requireOwnVendor(req);
  const bookings = await BookingModel.find({ vendorId: vendor._id });
  const completed = bookings.filter((b) => b.status === 'COMPLETED');
  const seen = new Set();
  const repeat = new Set();
  completed.forEach((b) => {
    const cid = String(b.customerId);
    if (seen.has(cid)) repeat.add(cid);
    seen.add(cid);
  });

  const now = new Date();
  const trend = [];
  for (let i = 5; i >= 0; i--) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    const count = bookings.filter((b) => b.createdAt >= monthStart && b.createdAt < monthEnd).length;
    trend.push({ month: monthStart.toLocaleString('en-US', { month: 'short' }), bookings: count });
  }

  res.json({
    totalBookings: bookings.length,
    completionRatePct: bookings.length === 0 ? 0 : Math.round((completed.length / bookings.length) * 100),
    avgRating: vendor.rating,
    repeatCustomers: repeat.size,
    trend,
  });
}

module.exports = {
  registerVendor,
  getMyVendor,
  patchMyVendor,
  patchMyAvailability,
  getMyAnalytics,
};
