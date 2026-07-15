const { Router } = require('express');
const { asyncHandler } = require('../lib/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { listCategories } = require('../controllers/categories.controller');
const {
  createVendorReview,
  getVendor,
  listVendorReviews,
  listVendors,
} = require('../controllers/vendors.controller');

const catalogRouter = Router();

catalogRouter.get('/categories', asyncHandler(listCategories));

catalogRouter.get('/vendors', asyncHandler(listVendors));
catalogRouter.get('/vendors/:id', asyncHandler(getVendor));
catalogRouter.get('/vendors/:id/reviews', asyncHandler(listVendorReviews));
catalogRouter.post('/vendors/:id/reviews', requireAuth, asyncHandler(createVendorReview));

module.exports = { catalogRouter };
