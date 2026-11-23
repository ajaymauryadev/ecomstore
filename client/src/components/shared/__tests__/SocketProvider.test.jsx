import { act, render } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { useEffect } from 'react';
import { describe, expect, test, vi } from 'vitest';
import authReducer, { setCredentials, clearCredentials } from '../../../features/auth/authSlice';
import SocketProvider from '../SocketProvider';
import { useSocket } from '../../../hooks/useSocket';

const { connections, connect } = vi.hoisted(() => {
  const connections = [];
  return { connections, connect: vi.fn((_url, options) => {
    const handlers = new Map();
    const socket = {
      options, any: null,
      onAny: vi.fn((handler) => { socket.any = handler; }),
      offAny: vi.fn(() => { socket.any = null; }),
      on: vi.fn((event, handler) => { handlers.set(event, handler); }),
      removeAllListeners: vi.fn(() => handlers.clear()),
      disconnect: vi.fn(), emit: vi.fn(),
      receive: (event, data) => socket.any?.(event, data),
      ready: () => handlers.get('connect')?.(),
    };
    connections.push(socket);
    return socket;
  }) };
});
vi.mock('socket.io-client', () => ({ io: connect }));

function Listener({ receive }) {
  const { on } = useSocket();
  useEffect(() => on('notification:new', receive), [on, receive]);
  return null;
}

describe('shared socket lifecycle', () => {
  test('retains early subscriptions through token rotation and closes the connection on logout', () => {
    connections.length = 0;
    const store = configureStore({ reducer: { auth: authReducer } });
    const credentials = (accessToken) => ({ user: { _id: 'worker', role: 'packer' }, accessToken });
    store.dispatch(setCredentials(credentials('first-token')));
    const receive = vi.fn();
    render(<Provider store={store}><SocketProvider><Listener receive={receive} /><Listener receive={vi.fn()} /></SocketProvider></Provider>);
    expect(connections).toHaveLength(1);
    act(() => connections[0].receive('notification:new', { id: 1 }));
    expect(receive).toHaveBeenCalledOnce();
    expect(receive).toHaveBeenCalledWith({ id: 1 });
    act(() => store.dispatch(setCredentials(credentials('rotated-token'))));
    expect(connections).toHaveLength(2);
    expect(connections[0].disconnect).toHaveBeenCalledOnce();
    expect(connections[1].options.auth.token).toBe('rotated-token');
    act(() => connections[0].receive('notification:new', { id: 'stale' }));
    act(() => { connections[1].ready(); connections[1].receive('notification:new', { id: 2 }); });
    expect(receive.mock.calls).toEqual([[{ id: 1 }], [{ id: 2 }]]);
    act(() => store.dispatch(clearCredentials()));
    expect(connections[1].disconnect).toHaveBeenCalledOnce();
    act(() => connections[1].receive('notification:new', { id: 'logged-out' }));
    expect(receive).toHaveBeenCalledTimes(2);
  });
});
