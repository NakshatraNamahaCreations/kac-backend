const { z } = require('zod');
const { VendorModel } = require('../models/Vendor');
const { BookingModel } = require('../models/Booking');
const { EmployeeModel, EmployeeReferralModel } = require('../models/Employee');
const { fail } = require('../lib/httpError');
const { detectReferralKind } = require('../lib/referralCode');
const { servicesForCategories } = require('../lib/categoryServices');
const { creditOnboardingForVendorPhone, creditReferralCodeForAgent } = require('./agent.controller');

const registerSchema = z.object({
  categories: z.array(z.string()).min(1),
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
    services: servicesForCategories(body.categories),
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
});

async function patchMyVendor(req, res) {
  const { categories, ...rest } = patchVendorSchema.parse(req.body);
  const vendor = await requireOwnVendor(req);

  // A paid "add service" purchase PATCHes the full updated categories list.
  // Grant the new category's starter services so the purchase actually
  // takes effect, instead of just recording the category id with nothing
  // bookable behind it.
  if (categories) {
    const existing = new Set(vendor.categories);
    const added = categories.filter((c) => !existing.has(c));
    if (added.length > 0) {
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
