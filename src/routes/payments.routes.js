const { Router } = require('express');
const { asyncHandler } = require('../lib/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const {
  createAgentOrder,
  createCustomerWalletOrder,
  createVendorOrder,
  createWalletOrder,
  verifyPayment,
} = require('../controllers/payments.controller');

const paymentsRouter = Router();
paymentsRouter.use(requireAuth);

paymentsRouter.post('/payments/vendor-order', asyncHandler(createVendorOrder));
paymentsRouter.post('/payments/agent-order', asyncHandler(createAgentOrder));
// Agent/vendor wallet (AgentModel.walletCoins) vs the customer coin balance
// (User.walletCoins) are separate pools — same split as the /wallet routes.
paymentsRouter.post('/payments/wallet-order', requireRole('agent', 'vendor'), asyncHandler(createWalletOrder));
paymentsRouter.post('/payments/customer-wallet-order', asyncHandler(createCustomerWalletOrder));
paymentsRouter.post('/payments/verify', asyncHandler(verifyPayment));

module.exports = { paymentsRouter };
