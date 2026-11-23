import mongoose from 'mongoose';

// Keep the name and role at the time of the action, even after an account changes.
export const actorSnapshotSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  name: String,
  role: String,
  at: Date,
}, { _id: false });
