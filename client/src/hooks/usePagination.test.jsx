import { act, renderHook } from '@testing-library/react';
import { expect, test } from 'vitest';
import { pageCapacity, useClientPagination, usePagination } from './usePagination';

test('capacity fits smaller screens and grows with available list space', () => {
  expect(pageCapacity({ width: 360, height: 700, mode: 'products' })).toBe(1);
  expect(pageCapacity({ width: 1200, height: 1000, mode: 'products' })).toBe(4);
  expect(pageCapacity({ width: 1200, height: 1200, mode: 'compact' })).toBeGreaterThan(pageCapacity({ width: 1200, height: 700, mode: 'compact' }));
});
test('filter and viewport changes reset to the first page', () => {
  const { result, rerender } = renderHook(({ scope }) => usePagination(scope), { initialProps: { scope: 'all' } });
  act(() => result.current.setPage(4));
  expect(result.current.page).toBe(4);
  rerender({ scope: 'filtered' });
  expect(result.current.page).toBe(1);
  act(() => result.current.setPage(3));
  const original = window.innerHeight;
  act(() => { window.innerHeight = 1400; window.dispatchEvent(new Event('resize')); });
  expect(result.current.page).toBe(1);
  act(() => { window.innerHeight = original; window.dispatchEvent(new Event('resize')); });
});
test('every record remains reachable and deleting the last page clamps the local list', () => {
  const items = Array.from({ length: 25 }, (_, index) => index);
  const { result, rerender } = renderHook(({ rows }) => useClientPagination(rows), { initialProps: { rows: items } });
  const seen = [];
  for (let page = 1; page <= result.current.meta.totalPages; page += 1) {
    act(() => result.current.setPage(page)); seen.push(...result.current.items);
  }
  expect(seen).toEqual(items);
  rerender({ rows: [0] });
  expect(result.current.page).toBe(1);
  expect(result.current.items).toEqual([0]);
});
