const { Router } = require('express');
const { asyncHandler } = require('../lib/asyncHandler');
const { requireAdminAuth } = require('../middleware/auth');
const {
  adminLogin,
  createUser,
  getStats,
  listBookings,
  listUsers,
} = require('../controllers/admin.controller');

const adminRouter = Router();

adminRouter.post('/admin/login', asyncHandler(adminLogin));

adminRouter.use('/admin', requireAdminAuth);
adminRouter.get('/admin/stats', asyncHandler(getStats));
adminRouter.get('/admin/users', asyncHandler(listUsers));
adminRouter.post('/admin/users', asyncHandler(createUser));
adminRouter.get('/admin/bookings', asyncHandler(listBookings));

module.exports = { adminRouter };
