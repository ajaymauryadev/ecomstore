// Isolated query-plan comparison. Never loads .env or uses the application DB.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { writeFile } from 'node:fs/promises';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Product from '../src/models/Product.js';

process.env.MONGOMS_DOWNLOAD_IGNORE_MISSING_HEADER = 'true';
const improvedIndexes = new Set(['catalog_recent', 'catalog_counter', 'catalog_storefront', 'catalog_recent_page', 'catalog_counter_page']);
const mongo = await MongoMemoryServer.create();
try {
  await mongoose.connect(mongo.getUri(), { autoIndex: false });
  const collection = Product.collection;
  const tenantId = new mongoose.Types.ObjectId();
  const otherTenant = new mongoose.Types.ObjectId();
  const perTenant = 5000;
  const now = Date.now();
  for (const tenant of [tenantId, otherTenant]) {
    await collection.insertMany(Array.from({ length: perTenant }, (_, i) => ({
      tenantId: tenant,
      name: `Product ${String(i).padStart(5, '0')}`,
      brand: 'Synthetic', isActive: i % 10 !== 0, isOnline: i % 7 !== 0,
      isFeatured: i % 11 === 0, images: [], tags: [],
      variants: [{ _id: new mongoose.Types.ObjectId(), name: '1 kg', unit: 'kg', isActive: true,
        stock: 20, lowStockLimit: 5, retailPrice: 100, purchasePrice: 60, offerPrice: null }],
      createdAt: new Date(now - i * 1000), updatedAt: new Date(now - i * 1000),
    })));
  }
  const definitions = Product.schema.indexes();
  for (const [key, options] of definitions.filter(([, options]) => !improvedIndexes.has(options.name))) {
    await collection.createIndex(key, options);
  }
  const queries = [
    { name: 'admin_recent', filter: { tenantId }, sort: { updatedAt: -1, _id: 1 } },
    { name: 'counter_catalog', filter: { tenantId, isActive: true }, sort: { name: 1, _id: 1 } },
    { name: 'storefront_default', filter: { tenantId, isActive: true, isOnline: true,
      variants: { $elemMatch: { isActive: true } } }, sort: { isFeatured: -1, updatedAt: -1, _id: 1 } },
  ];
  const hasSort = (node) => node && typeof node === 'object' &&
    (node.stage === 'SORT' || Object.values(node).some((child) => hasSort(child)));
  const measure = async () => {
    const results = [];
    for (const query of queries) {
      const run = () => collection.find(query.filter).sort(query.sort).limit(24);
      const rows = await run().toArray();
      const plan = await run().explain('executionStats');
      const samples = [];
      for (let i = 0; i < 30; i += 1) {
        const start = performance.now();
        await run().toArray();
        samples.push(performance.now() - start);
      }
      samples.sort((a, b) => a - b);
      results.push({ name: query.name, ids: rows.map((row) => String(row._id)),
        returned: plan.executionStats.nReturned,
        documentsExamined: plan.executionStats.totalDocsExamined,
        blockingSort: Boolean(hasSort(plan.queryPlanner.winningPlan)),
        queryP95Ms: Number(samples[Math.ceil(samples.length * 0.95) - 1].toFixed(2)) });
    }
    return results;
  };
  const before = await measure();
  for (const [key, options] of definitions.filter(([, options]) => improvedIndexes.has(options.name))) {
    await collection.createIndex(key, options);
  }
  const after = await measure();
  for (let i = 0; i < after.length; i += 1) {
    assert.deepEqual(after[i].ids, before[i].ids, `${after[i].name}: results changed`);
    assert.equal(after[i].blockingSort, false, `${after[i].name}: still uses a blocking sort`);
    assert.ok(after[i].documentsExamined <= 24, `${after[i].name}: scans beyond the requested page`);
  }
  const withoutIds = ({ ids, ...row }) => row;
  const report = { generatedAt: new Date().toISOString(), products: perTenant * 2,
    productsPerTenant: perTenant, samplesPerQuery: 30, pageSize: 24,
    scope: 'Local disposable MongoDB; warm sequential find queries, not API or hosting latency. Counts, search, price sorting and deep pagination are not benchmarked.',
    before: before.map(withoutIds), after: after.map(withoutIds) };
  if (process.argv[2]) await writeFile(process.argv[2], `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await mongoose.disconnect();
  await mongo.stop();
}
