// Every response DTO on the mobile app uses a string `id` field, not Mongo's
// `_id`/`__v`. Apply this to every schema so `.toJSON()` output matches the
// client's types without per-controller mapping.
function applyIdTransform(schema) {
  schema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform: (_doc, ret) => {
      ret.id = String(ret._id);
      delete ret._id;
    },
  });
}

module.exports = { applyIdTransform };
