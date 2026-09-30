const { Router } = require('express');
const { asyncHandler } = require('../lib/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const {
  createOnboarding,
  requireActiveAgent,
  getAgentDashboard,
  listOnboardings,
  registerAgent,
} = require('../controllers/agent.controller');

const agentRouter = Router();
agentRouter.use(requireAuth);

agentRouter.post('/agent/register', asyncHandler(registerAgent));
agentRouter.get('/agent/dashboard', requireRole('agent'), asyncHandler(getAgentDashboard));
// Onboarding vendors needs an admin-approved agent (requireActiveAgent);
// the dashboard stays open so the app can read verificationStatus.
agentRouter.post('/agent/onboard', requireRole('agent'), requireActiveAgent, asyncHandler(createOnboarding));
agentRouter.get('/agent/onboardings', requireRole('agent'), requireActiveAgent, asyncHandler(listOnboardings));

module.exports = { agentRouter };
