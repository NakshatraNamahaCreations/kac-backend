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
  // Render terminates TLS in front of the app and forwards plain HTTP, only
  // recording the real scheme in X-Forwarded-Proto. Without this, req.protocol
  // always reads 'http' — which introVideo.controller.js relies on being
  // correct to build the uploaded video's playable URL.
  app.set('trust proxy', 1);
  app.use(cors({ origin: env.corsOrigin }));
  // Photo uploads arrive as base64 JSON, far past express.json's 100kb
  // default. Only /uploads gets the big limit (and only for authed users,
  // see uploads.routes.js) — this must come BEFORE the global parser, which
  // skips a request whose body was already parsed. Everything else, incl.
  // the unauthenticated OTP endpoints, keeps the small default.
  app.use('/uploads', express.json({ limit: '9mb' }));
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
