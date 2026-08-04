const { Router } = require('express');
const { asyncHandler } = require('../lib/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const {
  getMyAnalytics,
  getMyVendor,
  patchMyAvailability,
  patchMyVendor,
  registerVendor,
} = require('../controllers/vendorSelf.controller');
const { listMyVendorReferrals } = require('../controllers/vendorReferral.controller');

const vendorSelfRouter = Router();
vendorSelfRouter.use(requireAuth);

vendorSelfRouter.post('/vendor/register', asyncHandler(registerVendor));
vendorSelfRouter.get('/vendor/me', asyncHandler(getMyVendor));
vendorSelfRouter.patch('/vendor/me', asyncHandler(patchMyVendor));
vendorSelfRouter.patch('/vendor/me/availability', asyncHandler(patchMyAvailability));
vendorSelfRouter.get('/vendor/analytics', asyncHandler(getMyAnalytics));
vendorSelfRouter.get('/vendor/me/referrals', asyncHandler(listMyVendorReferrals));

module.exports = { vendorSelfRouter };
