const { z } = require('zod');
const { BookingModel } = require('../models/Booking');
const { VendorModel } = require('../models/Vendor');
const { ReviewModel } = require('../models/Review');
const { UserModel } = require('../models/User');
const { AgentModel } = require('../models/Agent');
const { LedgerEntryModel } = require('../models/LedgerEntry');
const { fail } = require('../lib/httpError');
const { buildPage, parseCursor } = require('../lib/pagination');
const { agentReferralCode } = require('../lib/referralCode');
const { normalizePhone } = require('../lib/phone');
const { io } = require('../realtime/socket');

// Event name/payload must match what SocketProvider.jsx listens for
// ('booking.updated', with vendorName so the customer's toast can read it).
function emitBookingStatus(booking) {
  io()?.to(`user:${String(booking.customerId)}`).emit('booking.updated', {
    bookingId: String(booking._id),
    status: booking.status,
    vendorName: booking.vendorName,
  });
}

// Wallet balance lives on the Agent document regardless of role — a vendor
// has no separate wallet field of their own (see wallet.controller.js's
// requireOwnAgent, same shape, duplicated here rather than imported since
// wallet.controller.js doesn't export it). Auto-provisioned on first touch
// so a vendor who never opened Wallet doesn't 404 here.
async function requireOwnAgent(userId) {
  let agent = await AgentModel.findOne({ userId });
  if (!agent) {
    agent = await AgentModel.create({ userId, executiveCode: agentReferralCode(String(userId)), bankAccounts: [], walletCoins: 0 });
  }
  return agent;
}

const ACTIVE_STATUSES = ['REQUESTED', 'ACCEPTED', 'IN_PROGRESS'];
const PAST_STATUSES = ['COMPLETED', 'DECLINED', 'CANCELLED'];

const createBookingSchema = z.object({
  vendorId: z.string(),
  serviceId: z.string(),
  // Optional — the customer app's "call vendor" flow is ad-hoc (no slot
  // picker), unlike a scheduled-appointment booking. Defaults to "today,
  // ASAP" so the (required) DB fields still get a sensible value.
  date: z.string().optional(),
  slot: z.string().optional(),
  notes: z.string().optional(),
});

async function createBooking(req, res) {
  const body = createBookingSchema.parse(req.body);
  const vendor = await VendorModel.findById(body.vendorId);
  if (!vendor) fail(404, 'VENDOR_NOT_FOUND', 'Vendor not found.');
  const service = vendor.services.id(body.serviceId);
  if (!service) fail(404, 'SERVICE_NOT_FOUND', 'Service not found.');

  const booking = await BookingModel.create({
    customerId: req.user._id,
    customerName: req.user.name ?? 'Customer',
    customerPhone: req.user.phone,
    customerAvatarUrl: req.user.avatarUrl ?? null,
    vendorId: vendor._id,
    vendorName: vendor.name,
    serviceId: String(service._id),
    serviceName: service.name,
    date: body.date ?? new Date().toISOString().slice(0, 10),
    slot: body.slot ?? 'ASAP',
    notes: body.notes ?? null,
  });

  res.status(201).json(booking.toJSON());
}

const MANUAL_BOOKING_FEE_COINS = 250;

const manualBookingSchema = z.object({
  vendorId: z.string(),
  serviceId: z.string(),
  customerName: z.string().min(1),
  customerPhone: z.string().min(6),
  notes: z.string().optional(),
});

// A vendor refers a walk-in/phone-in customer to a DIFFERENT vendor for a
// service they don't do themselves — e.g. a plumber sending a customer to
// an AC repair vendor. The referring vendor picks the target vendor +
// service, pays a flat lead fee from their own wallet immediately (whether
// or not the target vendor ends up accepting — matches how a referral fee
// works), and the booking lands on the TARGET vendor's Inbox as a normal
// REQUESTED lead, same as if the customer had booked them directly through
// the app (see createBooking above) — this does NOT auto-accept, since the
// referring vendor isn't the one doing the job.
async function createManualBooking(req, res) {
  const body = manualBookingSchema.parse(req.body);
  const targetVendor = await VendorModel.findById(body.vendorId);
  if (!targetVendor) fail(404, 'VENDOR_NOT_FOUND', 'Vendor not found.');
  const service = targetVendor.services.id(body.serviceId);
  if (!service) fail(404, 'SERVICE_NOT_FOUND', 'Service not found.');
  if (targetVendor.serviceQuota != null && targetVendor.servicesUsed >= targetVendor.serviceQuota) {
    fail(402, 'QUOTA_EXCEEDED', 'This vendor has used all completed jobs on their current plan.');
  }

  const agent = await requireOwnAgent(req.user._id);
  if (agent.walletCoins < MANUAL_BOOKING_FEE_COINS) {
    fail(
      402,
      'INSUFFICIENT_COINS',
      `You need ₹${MANUAL_BOOKING_FEE_COINS} in your wallet to log a booking. Recharge and try again.`,
    );
  }

  // Find-or-create the customer's own account by phone — the same identity
  // OTP login resolves to (see lib/phone.js), so if this customer ever opens
  // the app with this number they see the booking in their own history.
  const customerPhone = normalizePhone(body.customerPhone);
  const customerName = body.customerName.trim();
  let customer = await UserModel.findOne({ phone: customerPhone });
  if (!customer) {
    customer = await UserModel.create({ phone: customerPhone, name: customerName, roles: ['customer'] });
  } else if (!customer.roles.includes('customer')) {
    customer.roles.push('customer');
    await customer.save();
  }

  agent.walletCoins -= MANUAL_BOOKING_FEE_COINS;
  await agent.save();
  await LedgerEntryModel.create({
    ownerId: req.user._id,
    kind: 'debit',
    coins: MANUAL_BOOKING_FEE_COINS,
    balance: agent.walletCoins,
    description: `Referral fee — ${customerName} to ${targetVendor.name}`,
  });

  const booking = await BookingModel.create({
    customerId: customer._id,
    customerName,
    customerPhone,
    vendorId: targetVendor._id,
    vendorName: targetVendor.name,
    serviceId: String(service._id),
    serviceName: service.name,
    date: new Date().toISOString().slice(0, 10),
    slot: 'ASAP',
    notes: body.notes ?? null,
    status: 'REQUESTED',
  });

  res.status(201).json(booking.toJSON());
}

async function listBookings(req, res) {
  const role = typeof req.query.role === 'string' ? req.query.role : 'customer';
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const skip = parseCursor(typeof req.query.cursor === 'string' ? req.query.cursor : undefined);
  const limit = 10;

  const filter = {};
  if (role === 'vendor') {
    const vendor = await VendorModel.findOne({ userId: req.user._id });
    filter.vendorId = vendor ? vendor._id : null;
  } else {
    filter.customerId = req.user._id;
  }

  if (status === 'active') filter.status = { $in: ACTIVE_STATUSES };
  else if (status === 'past') filter.status = { $in: PAST_STATUSES };
  else if (status) filter.status = status;

  const [total, bookings] = await Promise.all([
    BookingModel.countDocuments(filter),
    BookingModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
  ]);
  res.json(buildPage(bookings.map((b) => b.toJSON()), skip, limit, total));
}

async function loadOwnedBooking(req) {
  const booking = await BookingModel.findById(req.params.id);
  if (!booking) fail(404, 'BOOKING_NOT_FOUND', 'Booking not found.');

  const vendor = await VendorModel.findOne({ userId: req.user._id });
  const isCustomer = String(booking.customerId) === String(req.user._id);
  const isVendor = vendor && String(booking.vendorId) === String(vendor._id);
  if (!isCustomer && !isVendor) fail(403, 'FORBIDDEN', 'You cannot access this booking.');

  return booking;
}

async function getBooking(req, res) {
  const booking = await loadOwnedBooking(req);
  res.json(booking.toJSON());
}

async function acceptBooking(req, res) {
  const booking = await BookingModel.findById(req.params.id);
  if (!booking) fail(404, 'BOOKING_NOT_FOUND', 'Booking not found.');
  const vendor = await VendorModel.findOne({ userId: req.user._id });
  if (!vendor || String(booking.vendorId) !== String(vendor._id)) {
    fail(403, 'FORBIDDEN', 'Only the vendor on this booking can accept it.');
  }
  if (booking.status !== 'REQUESTED') fail(400, 'INVALID_STATUS', 'Booking is not pending.');
  // Quota is driven purely by serviceQuota being non-null (null = unlimited,
  // set per-plan at registration — see VendorPlan.serviceQuota), not by the
  // plan's name. Previously this only fired when vendor.plan === 'BASIC',
  // which meant any admin-added tier with a finite quota was never enforced.
  if (vendor.serviceQuota != null && vendor.servicesUsed >= vendor.serviceQuota) {
    fail(402, 'QUOTA_EXCEEDED', 'You have used all completed jobs on your current plan. Upgrade to accept more.');
  }
  booking.status = 'ACCEPTED';
  await booking.save();
  emitBookingStatus(booking);
  res.json(booking.toJSON());
}

const actionBodySchema = z.object({ reason: z.string().optional() });

async function declineBooking(req, res) {
  actionBodySchema.parse(req.body ?? {});
  const booking = await BookingModel.findById(req.params.id);
  if (!booking) fail(404, 'BOOKING_NOT_FOUND', 'Booking not found.');
  const vendor = await VendorModel.findOne({ userId: req.user._id });
  if (!vendor || String(booking.vendorId) !== String(vendor._id)) {
    fail(403, 'FORBIDDEN', 'Only the vendor on this booking can decline it.');
  }
  if (booking.status !== 'REQUESTED') fail(400, 'INVALID_STATUS', 'Booking is not pending.');
  booking.status = 'DECLINED';
  await booking.save();
  emitBookingStatus(booking);
  res.json(booking.toJSON());
}

async function completeBooking(req, res) {
  const booking = await BookingModel.findById(req.params.id);
  if (!booking) fail(404, 'BOOKING_NOT_FOUND', 'Booking not found.');
  const vendor = await VendorModel.findOne({ userId: req.user._id });
  if (!vendor || String(booking.vendorId) !== String(vendor._id)) {
    fail(403, 'FORBIDDEN', 'Only the vendor on this booking can complete it.');
  }
  if (!['ACCEPTED', 'IN_PROGRESS'].includes(booking.status)) {
    fail(400, 'INVALID_STATUS', 'Booking is not in progress.');
  }
  booking.status = 'COMPLETED';
  await booking.save();
  emitBookingStatus(booking);
  vendor.servicesUsed += 1;
  await vendor.save();
  res.json(booking.toJSON());
}

const reviewBodySchema = z.object({ rating: z.number().min(1).max(5), text: z.string().max(2000) });

async function reviewBooking(req, res) {
  const body = reviewBodySchema.parse(req.body);
  const booking = await loadOwnedBooking(req);
  if (String(booking.customerId) !== String(req.user._id)) {
    fail(403, 'FORBIDDEN', 'Only the customer can review this booking.');
  }
  if (booking.status !== 'COMPLETED') fail(400, 'INVALID_STATUS', 'Booking is not completed yet.');

  const review = await ReviewModel.create({
    vendorId: booking.vendorId,
    customerId: req.user._id,
    customerName: req.user.name ?? 'You',
    rating: body.rating,
    text: body.text,
  });

  const stats = await ReviewModel.aggregate([
    { $match: { vendorId: booking.vendorId } },
    { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);
  if (stats[0]) {
    await VendorModel.updateOne(
      { _id: booking.vendorId },
      { $set: { rating: Math.round(stats[0].avg * 10) / 10, reviewCount: stats[0].count } },
    );
  }

  res.status(201).json(review.toJSON());
}

module.exports = {
  createBooking,
  createManualBooking,
  listBookings,
  getBooking,
  acceptBooking,
  declineBooking,
  completeBooking,
  reviewBooking,
};
