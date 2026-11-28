// Disposable local database only. Never loads .env or connects to the shop DB.
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Notification from '../src/models/Notification.js';

process.env.MONGOMS_DOWNLOAD_IGNORE_MISSING_HEADER = 'true';
const mongo = await MongoMemoryServer.create();
try {
  await mongoose.connect(mongo.getUri(), { autoIndex: false });
  const tenantId = new mongoose.Types.ObjectId();
  const ownerId = new mongoose.Types.ObjectId();
  const workerId = new mongoose.Types.ObjectId();
  const foreignTenant = new mongoose.Types.ObjectId();
  const rows = Array.from({ length: 3000 }, (_, i) => ({
    tenantId: i % 3 === 0 ? foreignTenant : tenantId,
    ...(i % 2 ? { userId: workerId, role: 'staff' } : { role: 'admin' }),
    type: 'new_order', title: 'Synthetic order', isRead: i % 4 === 0,
    createdAt: new Date(Date.now() - Math.floor(i / 3) * 1000),
  }));
  await Notification.collection.insertMany(rows);
  for (const [key, options] of Notification.schema.indexes()) await Notification.collection.createIndex(key, options);
  const hasSort = (node) => node && typeof node === 'object' &&
    (node.stage === 'SORT' || Object.values(node).some((child) => hasSort(child)));
  const results = [];
  for (const [name, filter] of [
    ['owner', { tenantId, $or: [{ userId: ownerId }, { userId: null, role: 'admin' }] }],
    ['worker', { tenantId, userId: workerId }],
  ]) {
    const query = Notification.collection.find(filter).sort({ createdAt: -1, _id: -1 }).limit(20);
    const plan = await query.explain('executionStats');
    const result = { inbox: name, returned: plan.executionStats.nReturned,
      documentsExamined: plan.executionStats.totalDocsExamined,
      blockingSort: Boolean(hasSort(plan.queryPlanner.winningPlan)) };
    if (result.blockingSort) console.log(JSON.stringify({ result, plan: plan.queryPlanner.winningPlan }, null, 2));
    assert.equal(result.returned, 20);
    assert.equal(result.blockingSort, false);
    // Owner role records are interleaved with personal staff notifications.
    assert.ok(result.documentsExamined <= 60);
    results.push(result);
  }
  console.log(JSON.stringify({ notifications: rows.length, pageSize: 20, results }, null, 2));
} finally {
  await mongoose.disconnect();
  await mongo.stop();
}
