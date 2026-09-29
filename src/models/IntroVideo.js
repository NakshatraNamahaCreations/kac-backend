const { Schema, model } = require('mongoose');
const { applyIdTransform } = require('./plugins');

// Singleton — the post-login "Welcome to GigKaar" tour video shown by the
// mobile IntroVideoScreen. Admin-managed (admin panel > Intro video), always
// looked up by this fixed id (see introVideo.controller.js).
//
// Exactly one of two sources is active at a time:
//   - a link (videoUrl) — YouTube or any direct file URL hosted elsewhere
//   - an uploaded file (videoFileId) — bytes stored in GridFS (see lib/gridfs.js),
//     since there's no S3/Cloudinary account configured
// Switching source clears the other (see introVideo.controller.js) so the
// two never silently disagree about which video is "the" video, and so an
// old GridFS upload doesn't linger unused and eating Atlas storage quota.
const SINGLETON_ID = 'intro_video';

const introVideoSchema = new Schema(
  {
    _id: { type: String, default: SINGLETON_ID },
    active: { type: Boolean, default: false },
    videoUrl: { type: String, default: '' },
    videoFileId: { type: Schema.Types.ObjectId, default: null },
    videoFileName: { type: String, default: '' },
    videoFileSize: { type: Number, default: 0 },
    videoContentType: { type: String, default: '' },
    thumbnailUrl: { type: String, default: '' },
    title: { type: String, default: '' },
    subtitle: { type: String, default: '' },
  },
  { timestamps: true },
);

applyIdTransform(introVideoSchema);
const IntroVideoModel = model('IntroVideo', introVideoSchema);

module.exports = { IntroVideoModel, SINGLETON_ID };
