const http = require('node:http');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { env } = require('./config/env');
const { connectDb } = require('./db/connect');
const { apiRouter } = require('./routes');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { initSocket } = require('./realtime/socket');

async function main() {
  await connectDb();

  const app = express();
  app.use(cors({ origin: env.corsOrigin }));
  app.use(express.json());
  app.use(morgan('dev'));

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use(apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  const server = http.createServer(app);
  initSocket(server);

  server.listen(env.port, () => {
    // eslint-disable-next-line no-console
    console.log(`[server] listening on http://localhost:${env.port}`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[server] fatal startup error', err);
  process.exit(1);
});
