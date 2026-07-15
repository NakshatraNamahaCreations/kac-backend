const { Server } = require('socket.io');
const { verifyAccessToken } = require('../lib/jwt');
const { env } = require('../config/env');

let instance = null;

// Minimal realtime layer — matches socket.io-client on the mobile app.
// Clients authenticate with the same JWT access token used for REST calls,
// then join a room per booking to receive chat + status events.
function initSocket(server) {
  instance = new Server(server, {
    cors: { origin: env.corsOrigin },
  });

  instance.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('UNAUTHENTICATED'));
    try {
      const payload = verifyAccessToken(token);
      socket.data.userId = payload.sub;
      next();
    } catch {
      next(new Error('UNAUTHENTICATED'));
    }
  });

  instance.on('connection', (socket) => {
    socket.join(`user:${socket.data.userId}`);
    socket.on('booking:join', (bookingId) => {
      socket.join(`booking:${bookingId}`);
    });
    socket.on('booking:leave', (bookingId) => {
      socket.leave(`booking:${bookingId}`);
    });
  });

  return instance;
}

function io() {
  return instance;
}

module.exports = { initSocket, io };
