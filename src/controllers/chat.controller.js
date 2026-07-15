const { z } = require('zod');
const { MessageModel } = require('../models/Message');
const { BookingModel } = require('../models/Booking');
const { VendorModel } = require('../models/Vendor');
const { fail } = require('../lib/httpError');
const { buildPage, parseCursor } = require('../lib/pagination');
const { io } = require('../realtime/socket');

async function requireBookingAccess(req) {
  const booking = await BookingModel.findById(req.params.bookingId);
  if (!booking) fail(404, 'BOOKING_NOT_FOUND', 'Booking not found.');
  const vendor = await VendorModel.findOne({ userId: req.user._id });
  const isCustomer = String(booking.customerId) === String(req.user._id);
  const isVendor = vendor && String(booking.vendorId) === String(vendor._id);
  if (!isCustomer && !isVendor) fail(403, 'FORBIDDEN', 'You cannot access this conversation.');
  return { booking, role: isCustomer ? 'customer' : 'vendor' };
}

async function listMessages(req, res) {
  const { booking } = await requireBookingAccess(req);
  const skip = parseCursor(typeof req.query.cursor === 'string' ? req.query.cursor : undefined);
  const limit = 30;
  // Ascending (oldest-first) to match the mobile app's assumption that the
  // last item across all loaded pages is the newest message (it appends
  // optimistic sends to the end and scrollToEnd()s there).
  const [total, messages] = await Promise.all([
    MessageModel.countDocuments({ bookingId: booking._id }),
    MessageModel.find({ bookingId: booking._id }).sort({ createdAt: 1 }).skip(skip).limit(limit),
  ]);
  res.json(buildPage(messages.map((m) => m.toJSON()), skip, limit, total));
}

const sendMessageSchema = z.object({ text: z.string().min(1).max(4000) });

async function sendMessage(req, res) {
  const body = sendMessageSchema.parse(req.body);
  const { booking, role } = await requireBookingAccess(req);
  const message = await MessageModel.create({
    bookingId: booking._id,
    authorId: req.user._id,
    authorRole: role,
    text: body.text,
  });
  const json = message.toJSON();
  // SocketProvider.jsx destructures `{ message }` from the payload, not the
  // raw message object.
  io()?.to(`booking:${String(booking._id)}`).emit('chat.message', { message: json });
  res.status(201).json(json);
}

module.exports = { listMessages, sendMessage };
