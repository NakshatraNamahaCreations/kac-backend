const { Router } = require('express');
const { asyncHandler } = require('../lib/asyncHandler');
const { requireAdminAuth } = require('../middleware/auth');
const {
  adminChangePassword,
  adminLogin,
  adminSetup,
  createUser,
  getStats,
  getUserDetail,
  listBookings,
  listUsers,
} = require('../controllers/admin.controller');
const {
  createPlan,
  deletePlan,
  listPlansAdmin,
  updatePlan,
} = require('../controllers/rechargePlan.controller');

const adminRouter = Router();

// Unauthenticated — see admin.controller.js for why (bootstrap has no token
// to check yet; change-password verifies the current password itself).
adminRouter.post('/admin/setup', asyncHandler(adminSetup));
adminRouter.post('/admin/login', asyncHandler(adminLogin));
adminRouter.post('/admin/change-password', asyncHandler(adminChangePassword));

adminRouter.use('/admin', requireAdminAuth);
adminRouter.get('/admin/stats', asyncHandler(getStats));
adminRouter.get('/admin/users', asyncHandler(listUsers));
adminRouter.get('/admin/users/:role/:id', asyncHandler(getUserDetail));
adminRouter.post('/admin/users', asyncHandler(createUser));
adminRouter.get('/admin/bookings', asyncHandler(listBookings));
adminRouter.get('/admin/plans', asyncHandler(listPlansAdmin));
adminRouter.post('/admin/plans', asyncHandler(createPlan));
adminRouter.patch('/admin/plans/:id', asyncHandler(updatePlan));
adminRouter.delete('/admin/plans/:id', asyncHandler(deletePlan));

module.exports = { adminRouter };
