const { Router } = require('express');
const { asyncHandler } = require('../lib/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { createUpload, getUpload } = require('../controllers/uploads.controller');

const uploadsRouter = Router();
uploadsRouter.use(requireAuth);

uploadsRouter.post('/uploads', asyncHandler(createUpload));
uploadsRouter.get('/uploads/:id', asyncHandler(getUpload));

module.exports = { uploadsRouter };
