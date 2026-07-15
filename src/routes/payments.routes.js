const { Router } = require('express');
const { asyncHandler } = require('../lib/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { createAgentOrder, createVendorOrder, verifyPayment } = require('../controllers/payments.controller');

const paymentsRouter = Router();
paymentsRouter.use(requireAuth);

paymentsRouter.post('/payments/vendor-order', asyncHandler(createVendorOrder));
paymentsRouter.post('/payments/agent-order', asyncHandler(createAgentOrder));
paymentsRouter.post('/payments/verify', asyncHandler(verifyPayment));

module.exports = { paymentsRouter };
