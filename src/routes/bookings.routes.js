const { Router } = require('express');
const { asyncHandler } = require('../lib/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const {
  acceptBooking,
  completeBooking,
  createBooking,
  declineBooking,
  getBooking,
  listBookings,
  reviewBooking,
} = require('../controllers/bookings.controller');

const bookingsRouter = Router();
bookingsRouter.use(requireAuth);

bookingsRouter.post('/bookings', asyncHandler(createBooking));
bookingsRouter.get('/bookings', asyncHandler(listBookings));
bookingsRouter.get('/bookings/:id', asyncHandler(getBooking));
bookingsRouter.patch('/bookings/:id/accept', asyncHandler(acceptBooking));
bookingsRouter.patch('/bookings/:id/decline', asyncHandler(declineBooking));
bookingsRouter.patch('/bookings/:id/complete', asyncHandler(completeBooking));
bookingsRouter.post('/bookings/:id/review', asyncHandler(reviewBooking));

module.exports = { bookingsRouter };
