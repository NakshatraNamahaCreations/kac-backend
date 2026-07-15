const { Router } = require('express');
const { asyncHandler } = require('../lib/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { listMessages, sendMessage } = require('../controllers/chat.controller');

const chatRouter = Router();
chatRouter.use(requireAuth);

chatRouter.get('/chat/:bookingId/messages', asyncHandler(listMessages));
chatRouter.post('/chat/:bookingId/messages', asyncHandler(sendMessage));

module.exports = { chatRouter };
