import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector, useStore } from 'react-redux';
import { setCredentials, clearCredentials, setInitialized } from '../../features/auth/authSlice';
import { useRefreshTokenMutation, useLogoutMutation } from '../../features/auth/authApi';
import StartupShell from '../layout/StartupShell';
import Button from '../ui/Button';

export default function AuthInit({ children }) {
  const dispatch = useDispatch();
  const store = useStore();
  const isInitialized = useSelector((state) => state.auth.isInitialized);
  const offlineSession = useSelector((state) => state.auth.offlineSession);
  const logoutPending = useSelector((state) => state.savedData?.logoutPending);
  const [refresh] = useRefreshTokenMutation();
  const [logout] = useLogoutMutation();
  const pending = useRef(null);
  const [attempt, setAttempt] = useState(0);
  const [recovering, setRecovering] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (isInitialized && !logoutPending) return;
    let active = true;
    let timer;
    const retry = () => setAttempt((value) => value + 1);
    const init = async () => {
      setRetrying(true);
      // StrictMode replays effects; both effects must await the same rotation.
      const request = pending.current ??= (logoutPending ? logout({ requireServerConfirmation: true }) : refresh()).unwrap();
      try {
        const result = await request;
        if (!active) return;
        if (logoutPending) { dispatch(clearCredentials()); dispatch(setInitialized()); return; }
        if (!result?.data?.accessToken || !result.data.user) throw new Error('Invalid session response');
        dispatch(setCredentials(result.data));
      } catch (error) {
        if (!active) return;
        if ([401, 403].includes(error.status)) {
          // Confirming an existing guest is not a session change: resetting the
          // cache here would interrupt public reads and hide saved storefronts.
          const auth = store.getState().auth;
          if (auth.user || auth.accessToken) dispatch(clearCredentials());
          dispatch(setInitialized());
        } else {
          // A failed server/network request does not establish that the user is signed out.
          setRecovering(true);
          const delay = error.data?.retryAt ? Math.max(1000, error.data.retryAt - Date.now()) : Math.min(60000, 5000 * 2 ** Math.min(attempt, 4));
          if (navigator.onLine !== false) timer = setTimeout(retry, delay);
        }
      } finally {
        if (pending.current === request) pending.current = null;
        if (active) setRetrying(false);
      }
    };
    init();
    window.addEventListener('online', retry);
    return () => {
      active = false;
      clearTimeout(timer);
      window.removeEventListener('online', retry);
    };
  }, [attempt, dispatch, store, isInitialized, refresh, logout, logoutPending]);

  const publicPage = /^\/(?:login|register|unauthorized)\/?$/.test(window.location.pathname) || window.location.pathname.startsWith('/s/');
  if (isInitialized || offlineSession || publicPage) return children;
  if (!recovering) return <StartupShell />;
  return (
    <StartupShell>
      <div role="status">
        <h1 className="text-xl font-bold text-slate-100">Connection interrupted</h1>
        <p className="text-sm text-slate-400 mt-2">Your session could not be checked. Retrying automatically.</p>
        <Button className="mt-5" isLoading={retrying} onClick={() => setAttempt((value) => value + 1)}>Try again</Button>
      </div>
    </StartupShell>
  );
}
