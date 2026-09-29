const mongoose = require('mongoose');
const { env } = require('../config/env');

async function connectDb() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.mongoUri);
  // Never log the credentials — the URI carries the DB user's password and
  // this line lands in Render's logs.
  const safeUri = env.mongoUri.replace(/\/\/[^@/]*@/, '//***@');
  // eslint-disable-next-line no-console
  console.log(`[db] connected to ${safeUri}`);
}

module.exports = { connectDb };
