const mongoose = require('mongoose');
const { env } = require('../config/env');

async function connectDb() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.mongoUri);
  // eslint-disable-next-line no-console
  console.log(`[db] connected to ${env.mongoUri}`);
}

module.exports = { connectDb };
