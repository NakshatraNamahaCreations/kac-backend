const { Schema, model } = require('mongoose');
const { applyIdTransform } = require('./plugins');

const messageSchema = new Schema(
  {
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true, index: true },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    authorRole: { type: String, enum: ['customer', 'vendor', 'agent', 'employee'], required: true },
    text: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

applyIdTransform(messageSchema);

const MessageModel = model('Message', messageSchema);

module.exports = { MessageModel };
