import { expect, test } from 'vitest';
import { workspaceReadPlan } from './workspaceReadPlan';
import { PAGE_SIZE } from '../constants/pagination';

test('prepares the exact unvisited Supplier Dues query and all owner navigation destinations', () => {
  const plan = workspaceReadPlan({ role: 'store_owner' }, { slug: 'test' });
  expect(plan.find(({ path }) => path === '/store/supplier-payments').queries)
    .toEqual([['getSuppliers', { page: 1, limit: PAGE_SIZE }]]);
  for (const path of ['/store/expenses', '/store/salary', '/store/sales', '/store/packing/work', '/store/reports', '/store/settings']) {
    expect(plan.some((view) => view.path === path)).toBe(true);
  }
  expect(plan.flatMap(({ queries }) => queries).every(([endpoint]) => endpoint.startsWith('get'))).toBe(true);
});

test('does not warm private accounting or administration data for a packer', () => {
  const plan = workspaceReadPlan({ role: 'packer' }, { slug: 'test' });
  expect(plan.map(({ path }) => path)).toEqual([
    '/store/products', '/store/categories', '/staff/dashboard', '/store/packing/work', '/store/notifications',
  ]);
});

test('uses the store accounting timezone for unvisited daily views', () => {
  const user = { role: 'store_owner' };
  const plan = workspaceReadPlan(user, { settings: { timezone: 'Asia/Kolkata' } });
  const query = plan.find(({ path }) => path === '/store/daily-closing').queries[0];
  expect(query[1].date).toBe(new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Kolkata', dateStyle: 'short' }).format(new Date()));
});
