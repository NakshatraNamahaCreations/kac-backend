const { Router } = require('express');
const { sessionRouter } = require('./session.routes');
const { catalogRouter } = require('./catalog.routes');
const { bookingsRouter } = require('./bookings.routes');
const { vendorSelfRouter } = require('./vendorSelf.routes');
const { agentRouter } = require('./agent.routes');
const { employeeRouter } = require('./employee.routes');
const { walletRouter } = require('./wallet.routes');
const { paymentsRouter } = require('./payments.routes');
const { chatRouter } = require('./chat.routes');

const apiRouter = Router();

apiRouter.use(sessionRouter);
apiRouter.use(catalogRouter);
apiRouter.use(bookingsRouter);
apiRouter.use(vendorSelfRouter);
apiRouter.use(agentRouter);
apiRouter.use(employeeRouter);
apiRouter.use(walletRouter);
apiRouter.use(paymentsRouter);
apiRouter.use(chatRouter);

module.exports = { apiRouter };
