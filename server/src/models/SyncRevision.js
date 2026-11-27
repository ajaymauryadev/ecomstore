import mongoose from 'mongoose';

// Shared by API replicas; a process restart never resets the change counter.
const schema = new mongoose.Schema({
  _id: String,
  revision: { type: Number, default: 0 },
}, { versionKey: false });
export default mongoose.model('SyncRevision', schema);
