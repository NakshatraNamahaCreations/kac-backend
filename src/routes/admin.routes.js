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
  updateVendorVerification,
} = require('../controllers/admin.controller');
const {
  createPlan,
  deletePlan,
  listPlansAdmin,
  updatePlan,
} = require('../controllers/rechargePlan.controller');
const {
  createVendorPlan,
  deleteVendorPlan,
  listVendorPlansAdmin,
  updateVendorPlan,
} = require('../controllers/vendorPlan.controller');
const {
  createCategory,
  deleteCategory,
  listCategoriesAdmin,
  updateCategory,
} = require('../controllers/categoriesAdmin.controller');

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
adminRouter.patch('/admin/users/vendor/:id/verify', asyncHandler(updateVendorVerification));
adminRouter.get('/admin/bookings', asyncHandler(listBookings));
adminRouter.get('/admin/plans', asyncHandler(listPlansAdmin));
adminRouter.post('/admin/plans', asyncHandler(createPlan));
adminRouter.patch('/admin/plans/:id', asyncHandler(updatePlan));
adminRouter.delete('/admin/plans/:id', asyncHandler(deletePlan));
adminRouter.get('/admin/vendor-plans', asyncHandler(listVendorPlansAdmin));
adminRouter.post('/admin/vendor-plans', asyncHandler(createVendorPlan));
adminRouter.patch('/admin/vendor-plans/:tier', asyncHandler(updateVendorPlan));
adminRouter.delete('/admin/vendor-plans/:tier', asyncHandler(deleteVendorPlan));
adminRouter.get('/admin/categories', asyncHandler(listCategoriesAdmin));
adminRouter.post('/admin/categories', asyncHandler(createCategory));
adminRouter.patch('/admin/categories/:id', asyncHandler(updateCategory));
adminRouter.delete('/admin/categories/:id', asyncHandler(deleteCategory));

module.exports = { adminRouter };
