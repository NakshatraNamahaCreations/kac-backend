const { Router } = require('express');
const { asyncHandler } = require('../lib/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const {
  addRole,
  getMe,
  patchMe,
  refresh,
  requestOtp,
  setPushToken,
  verifyOtp,
  verifyOtpOnly,
} = require('../controllers/session.controller');
const { listMyCustomerReferrals } = require('../controllers/customerReferral.controller');
const {
  createChangeRequest,
  getMyKycDetails,
  listMyChangeRequests,
} = require('../controllers/myKyc.controller');

const sessionRouter = Router();

sessionRouter.post('/auth/otp/request', asyncHandler(requestOtp));
sessionRouter.post('/auth/otp/verify', asyncHandler(verifyOtp));
sessionRouter.post('/auth/otp/verify-only', asyncHandler(verifyOtpOnly));
sessionRouter.post('/auth/refresh', asyncHandler(refresh));

sessionRouter.get('/me', requireAuth, asyncHandler(getMe));
sessionRouter.patch('/me', requireAuth, asyncHandler(patchMe));
sessionRouter.post('/me/roles', requireAuth, asyncHandler(addRole));
sessionRouter.post('/me/push-token', requireAuth, asyncHandler(setPushToken));
sessionRouter.get('/me/referrals', requireAuth, asyncHandler(listMyCustomerReferrals));
// Vendor / agent: own full bank + KYC (view-only in the app) and change requests.
sessionRouter.get('/me/kyc-details', requireAuth, asyncHandler(getMyKycDetails));
sessionRouter.get('/me/change-requests', requireAuth, asyncHandler(listMyChangeRequests));
sessionRouter.post('/me/change-requests', requireAuth, asyncHandler(createChangeRequest));

module.exports = { sessionRouter };
