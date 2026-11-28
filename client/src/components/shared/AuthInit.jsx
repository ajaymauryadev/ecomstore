import { useEffect, useState } from 'react';
import { useDispatch, useSelector, useStore } from 'react-redux';
import { setCredentials, clearCredentials, setInitialized } from '../../features/auth/authSlice';
import { useRefreshTokenMutation, useLogoutMutation } from '../../features/auth/authApi';
import StartupShell from '../layout/StartupShell';
import Button from '../ui/Button';
import { Link, useLocation } from 'react-router-dom';

// The router can remount under StrictMode. Keep one refresh or pending sign-out
// request per store/session epoch until it settles.
const requests = new WeakMap();
const signInEndpoints = new Set(['login', 'register', 'customerLogin', 'customerRegister']);
const signingIn = (state) => Object.values(state.api?.mutations ?? {})
  .some((mutation) => mutation.status === 'pending' && signInEndpoints.has(mutation.endpointName));
function sessionRequest(store, kind, invoke) {
  const epoch = store.getState().auth.sessionEpoch;
  const current = requests.get(store);
  if (current?.epoch === epoch && current.kind === kind) return current.promise;
  const promise = invoke().unwrap();
  requests.set(store, { epoch, kind, promise });
  void promise.finally(() => {
    if (requests.get(store)?.promise === promise) requests.delete(store);
  }).catch(() => {});
  return promise;
}

export default function AuthInit({ children }) {
  const { pathname } = useLocation();
  const dispatch = useDispatch();
  const store = useStore();
  const isInitialized = useSelector((state) => state.auth.isInitialized);
  const offlineSession = useSelector((state) => state.auth.offlineSession);
  const logoutPending = useSelector((state) => state.savedData?.logoutPending);
  const identityReady = useSelector((state) => state.savedData?.identityReady ?? true);
  const identityError = useSelector((state) => state.savedData?.identityError);
  const signInRunning = useSelector(signingIn);
  const [refresh] = useRefreshTokenMutation();
  const [logout] = useLogoutMutation();
  const [attempt, setAttempt] = useState(0);
  const [recovering, setRecovering] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (!identityReady || identityError || signInRunning || (isInitialized && !logoutPending)) return;
    let active = true;
    let timer;
    const retry = () => setAttempt((value) => value + 1);
    const init = async () => {
      setRetrying(true);
      // StrictMode replays effects; both effects must await the same rotation.
      const epoch = store.getState().auth.sessionEpoch;
      const request = sessionRequest(store, logoutPending ? 'logout' : 'refresh',
        () => logoutPending ? logout({ requireServerConfirmation: true }) : refresh());
      try {
        const result = await request;
        if (!active || store.getState().auth.sessionEpoch !== epoch || signingIn(store.getState())) return;
        if (logoutPending) { dispatch(setInitialized()); return; }
        if (!result?.data?.accessToken || !result.data.user) throw new Error('Invalid session response');
        dispatch(setCredentials(result.data));
      } catch (error) {
        if (!active || store.getState().auth.sessionEpoch !== epoch || signingIn(store.getState())) return;
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
  }, [attempt, dispatch, store, isInitialized, refresh, logout, logoutPending, identityReady, identityError, signInRunning]);

  const publicPage = /^\/(?:login|register|unauthorized)\/?$/.test(pathname) || pathname.startsWith('/s/');
  if (publicPage || (identityReady && (isInitialized || offlineSession))) return children;
  if (identityError) return <StartupShell>
    <p role="status">Device storage could not be checked. Sign in again to verify access to this workspace.</p>
    <Link className="btn-secondary mt-4" to="/login">Sign in</Link>
  </StartupShell>;
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
