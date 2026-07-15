const { Schema, model } = require('mongoose');

// Uses the human-readable slug-style id (e.g. "cat_plumber") as the primary
// key so it matches the ids already baked into the mobile app's fixtures.
const categorySchema = new Schema({
  _id: { type: String },
  slug: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  description: { type: String, required: true },
  iconKey: { type: String, required: true },
  suggestedMinPaise: { type: Number },
  suggestedMaxPaise: { type: Number },
  active: { type: Boolean, default: true },
  tags: { type: [String], default: undefined },
  popular: { type: Boolean, default: false },
});

categorySchema.set('toJSON', {
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
  },
});

const CategoryModel = model('Category', categorySchema);

module.exports = { CategoryModel };
