import { act, renderHook } from '@testing-library/react';
import { expect, test } from 'vitest';
import { usePageSize, useClientPagination, usePagination } from './usePagination';

test.each(['rows', 'compact', 'cards', 'products', 'storefront'])('uses five items for %s on every device', (mode) => {
  const { result } = renderHook(() => usePageSize(mode));
  const original = { width: window.innerWidth, height: window.innerHeight };
  try {
    for (const [width, height] of [[320, 568], [768, 1024], [1440, 900], [2560, 1440]]) {
      act(() => { window.innerWidth = width; window.innerHeight = height; window.dispatchEvent(new Event('resize')); });
      expect(result.current.limit).toBe(5);
    }
  } finally {
    window.innerWidth = original.width;
    window.innerHeight = original.height;
  }
});
test('filter changes reset the page while viewport changes preserve it', () => {
  const { result, rerender } = renderHook(({ scope }) => usePagination(scope), { initialProps: { scope: 'all' } });
  act(() => result.current.setPage(4));
  expect(result.current.page).toBe(4);
  rerender({ scope: 'filtered' });
  expect(result.current.page).toBe(1);
  rerender({ scope: 'all' });
  expect(result.current.page).toBe(1);
  rerender({ scope: 'filtered' });
  act(() => result.current.setPage(3));
  const original = window.innerHeight;
  act(() => { window.innerHeight = 1400; window.dispatchEvent(new Event('resize')); });
  expect(result.current.page).toBe(3);
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
