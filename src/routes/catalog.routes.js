const { Router } = require('express');
const { asyncHandler } = require('../lib/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { listCategories } = require('../controllers/categories.controller');
const { listVendorPlansPublic } = require('../controllers/vendorPlan.controller');
const { getAgentPlanPublic } = require('../controllers/agentPlan.controller');
const { getAddServicePlan } = require('../controllers/addServicePlan.controller');
const { getIntroVideoPublic, streamIntroVideoFile } = require('../controllers/introVideo.controller');
const {
  createVendorReview,
  getVendor,
  listVendorReviews,
  listVendors,
} = require('../controllers/vendors.controller');

const catalogRouter = Router();

catalogRouter.get('/categories', asyncHandler(listCategories));
catalogRouter.get('/vendor-plans', asyncHandler(listVendorPlansPublic));
catalogRouter.get('/agent-plan', asyncHandler(getAgentPlanPublic));
// Public, like /agent-plan — the vendor app's "add service" fee card.
catalogRouter.get('/add-service-plan', asyncHandler(getAddServicePlan));
catalogRouter.get('/intro-video', asyncHandler(getIntroVideoPublic));
catalogRouter.get('/intro-video/file/:id', asyncHandler(streamIntroVideoFile));

catalogRouter.get('/vendors', asyncHandler(listVendors));
catalogRouter.get('/vendors/:id', asyncHandler(getVendor));
catalogRouter.get('/vendors/:id/reviews', asyncHandler(listVendorReviews));
catalogRouter.post('/vendors/:id/reviews', requireAuth, asyncHandler(createVendorReview));

module.exports = { catalogRouter };
