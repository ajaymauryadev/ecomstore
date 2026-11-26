import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { selectAccessToken, selectCurrentUser } from '../../features/auth/authSlice';
import { SocketContext } from '../../hooks/SocketContext';

export default function SocketProvider({ children }) {
  const token = useSelector(selectAccessToken);
  const userId = useSelector(selectCurrentUser)?._id;
  const connectionRef = useRef(null);
  const listeners = useRef(new Map());
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);

  // Retain subscriptions across token refresh, reconnect and child effect order.
  const on = useCallback((event, handler) => {
    const handlers = listeners.current.get(event) || new Set();
    handlers.add(handler);
    listeners.current.set(event, handlers);
    return () => {
      handlers.delete(handler);
      if (!handlers.size) listeners.current.delete(event);
    };
  }, []);
  const emit = useCallback((event, data) => connectionRef.current?.emit(event, data), []);

  useEffect(() => {
    if (import.meta.env.VITE_DISABLE_WEBSOCKETS === 'true' || !token || !userId) return undefined;
    let disposed = false;
    let connection;
    const publish = (event, ...args) => {
      if (disposed || connectionRef.current !== connection) return;
      for (const handler of [...(listeners.current.get(event) || [])]) handler(...args);
    };
    // Public startup and signed-out pages do not need the realtime transport.
    void import('socket.io-client').then(({ io }) => {
      if (disposed) return;
      connection = io(import.meta.env.VITE_WS_URL || undefined, {
        auth: { token }, transports: ['polling', 'websocket'],
        reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 10000,
      });
      connectionRef.current = connection;
      setSocket(connection);
      connection.onAny(publish);
      connection.on('connect', () => { setConnected(true); publish('connect'); });
      connection.on('disconnect', () => { setConnected(false); publish('disconnect'); });
      connection.on('connect_error', () => setConnected(false));
    }).catch(() => { if (!disposed) setConnected(false); });
    return () => {
      disposed = true;
      connection?.offAny(publish);
      connection?.removeAllListeners();
      connection?.disconnect();
      if (connectionRef.current === connection) connectionRef.current = null;
      setSocket(null);
      setConnected(false);
    };
  }, [token, userId]);

  const value = useMemo(() => ({ socket, connected, on, emit }), [socket, connected, on, emit]);
  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}
