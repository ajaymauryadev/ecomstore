import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';

const refreshTokenSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    token: {
      type: String,
      required: true,
      unique: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expireAfterSeconds: 0 },
    },
    isRevoked: {
      type: Boolean,
      default: false,
    },
    sessionId: { type: String, default: randomUUID },
    rotatedAt: Date,
    replacedByTokenHash: String,
    userAgent: String,
    ip: String,
  },
  { timestamps: true }
);

refreshTokenSchema.index({ userId: 1, isRevoked: 1 });

const RefreshToken = mongoose.model('RefreshToken', refreshTokenSchema);
export default RefreshToken;
