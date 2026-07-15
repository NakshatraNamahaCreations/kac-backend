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
} = require('../controllers/session.controller');

const sessionRouter = Router();

sessionRouter.post('/auth/otp/request', asyncHandler(requestOtp));
sessionRouter.post('/auth/otp/verify', asyncHandler(verifyOtp));
sessionRouter.post('/auth/refresh', asyncHandler(refresh));

sessionRouter.get('/me', requireAuth, asyncHandler(getMe));
sessionRouter.patch('/me', requireAuth, asyncHandler(patchMe));
sessionRouter.post('/me/roles', requireAuth, asyncHandler(addRole));
sessionRouter.post('/me/push-token', requireAuth, asyncHandler(setPushToken));

module.exports = { sessionRouter };
