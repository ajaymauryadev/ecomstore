import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { useNavigationPrefetch } from './useNavigationPrefetch';
import { prefetchRoute } from '../app/routePrefetch';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';

vi.mock('../app/routePrefetch', () => ({ prefetchRoute: vi.fn() }));
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
function Navigation() {
  return <nav {...useNavigationPrefetch()}><a href="/store/products">Products</a><a href="https://example.com">External</a></nav>;
}
const wrapper = ({ children }) => <Provider store={configureStore({ reducer: () => ({ auth: { accessToken: null } }) })}>{children}</Provider>;

test('preloads after hover dwell, cancels flyovers and ignores external links', () => {
  vi.useFakeTimers();
  render(<Navigation />, { wrapper });
  const link = screen.getByText('Products');
  fireEvent.pointerOver(link);
  fireEvent.pointerOut(link);
  act(() => vi.advanceTimersByTime(150));
  expect(prefetchRoute).not.toHaveBeenCalled();
  fireEvent.pointerOver(link);
  act(() => vi.advanceTimersByTime(100));
  expect(prefetchRoute).toHaveBeenCalledWith('/store/products');
  fireEvent.pointerOver(screen.getByText('External'));
  act(() => vi.advanceTimersByTime(100));
  expect(prefetchRoute).toHaveBeenCalledTimes(1);
});

test('supports keyboard focus and clears scheduled work on unmount', () => {
  vi.useFakeTimers();
  const { unmount } = render(<Navigation />, { wrapper });
  fireEvent.focus(screen.getByText('Products'));
  act(() => vi.advanceTimersByTime(100));
  expect(prefetchRoute).toHaveBeenCalledOnce();
  fireEvent.focus(screen.getByText('Products'));
  unmount();
  act(() => vi.advanceTimersByTime(100));
  expect(prefetchRoute).toHaveBeenCalledTimes(1);
});
