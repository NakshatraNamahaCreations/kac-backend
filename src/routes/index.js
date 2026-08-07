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
const { adminRouter } = require('./admin.routes');

const apiRouter = Router();

// adminRouter mounted first, deliberately: every other router below applies
// its requireAuth gate UNSCOPED (e.g. bookingsRouter.use(requireAuth), no
// path) — that runs for ANY request reaching that point in the chain, not
// just that router's own routes, since Express treats a path-less .use() as
// matching "/". Mounting admin later let bookingsRouter's gate 401 every
// /admin/* request before it ever reached adminRouter. Keep this first.
apiRouter.use(adminRouter);
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
