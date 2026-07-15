const { Router } = require('express');
const { asyncHandler } = require('../lib/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const {
  createOnboarding,
  getAgentDashboard,
  listOnboardings,
  registerAgent,
} = require('../controllers/agent.controller');

const agentRouter = Router();
agentRouter.use(requireAuth);

agentRouter.post('/agent/register', asyncHandler(registerAgent));
agentRouter.get('/agent/dashboard', requireRole('agent'), asyncHandler(getAgentDashboard));
agentRouter.post('/agent/onboard', requireRole('agent'), asyncHandler(createOnboarding));
agentRouter.get('/agent/onboardings', requireRole('agent'), asyncHandler(listOnboardings));

module.exports = { agentRouter };
