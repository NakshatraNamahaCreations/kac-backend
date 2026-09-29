const mongoose = require('mongoose');

// Video files (intro tour, etc.) are far past Mongo's 16MB single-document
// limit, so they can't live as a plain Buffer field the way Upload.js's
// photos do — GridFS chunks them into a separate collection instead. This
// stores them in the same Atlas cluster the rest of the app already uses
// (no S3/Cloudinary account is configured), which also means they survive
// Render's ephemeral disk across deploys, unlike a local /uploads folder.
function getBucket(bucketName) {
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName });
}

module.exports = { getBucket };
