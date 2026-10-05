const { Router } = require('express');
const { asyncHandler } = require('../lib/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const {
  createAgentOrder,
  createCustomerWalletOrder,
  createOnboardingOrder,
  createVendorOrder,
  createWalletOrder,
  getRegistrationPaymentStatus,
  verifyPayment,
} = require('../controllers/payments.controller');
const { requireActiveAgent } = require('../controllers/agent.controller');

const paymentsRouter = Router();
paymentsRouter.use(requireAuth);

paymentsRouter.get('/payments/registration-status', asyncHandler(getRegistrationPaymentStatus));
paymentsRouter.post('/payments/vendor-order', asyncHandler(createVendorOrder));
paymentsRouter.post('/payments/agent-order', asyncHandler(createAgentOrder));
paymentsRouter.post('/payments/onboarding-order', requireRole('agent'), requireActiveAgent, asyncHandler(createOnboardingOrder));
// Agent/vendor wallet (AgentModel.walletCoins) vs the customer coin balance
// (User.walletCoins) are separate pools — same split as the /wallet routes.
paymentsRouter.post('/payments/wallet-order', requireRole('agent', 'vendor'), asyncHandler(createWalletOrder));
paymentsRouter.post('/payments/customer-wallet-order', asyncHandler(createCustomerWalletOrder));
paymentsRouter.post('/payments/verify', asyncHandler(verifyPayment));

module.exports = { paymentsRouter };
