import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { setCredentials, setInitialized, selectIsInitialized } from '../../features/auth/authSlice';
import { useRefreshTokenMutation } from '../../features/auth/authApi';
import { PageLoader } from '../ui/Spinner';
import Button from '../ui/Button';

export default function AuthInit({ children }) {
  const dispatch = useDispatch();
  const isInitialized = useSelector(selectIsInitialized);
  const [refresh] = useRefreshTokenMutation();
  const pending = useRef(null);
  const [attempt, setAttempt] = useState(0);
  const [recovering, setRecovering] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (isInitialized) return;
    let active = true;
    let timer;
    const retry = () => setAttempt((value) => value + 1);
    const init = async () => {
      setRetrying(true);
      // StrictMode replays effects; both effects must await the same rotation.
      const request = pending.current ??= refresh().unwrap();
      try {
        const result = await request;
        if (!active) return;
        if (!result?.data?.accessToken || !result.data.user) throw new Error('Invalid session response');
        dispatch(setCredentials(result.data));
      } catch (error) {
        if (!active) return;
        if ([401, 403].includes(error.status)) {
          dispatch(setInitialized());
        } else {
          // A failed server/network request does not establish that the user is signed out.
          setRecovering(true);
          const delay = error.data?.retryAt ? Math.max(1000, error.data.retryAt - Date.now()) : 5000;
          timer = setTimeout(retry, delay);
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
  }, [attempt, dispatch, isInitialized, refresh]);

  if (isInitialized) return children;
  if (!recovering) return <PageLoader />;
  return (
    <main className="workspace-theme min-h-screen bg-navy-950 flex items-center justify-center p-6">
      <div className="card max-w-md p-8 text-center" role="status">
        <h1 className="text-xl font-bold text-slate-100">Connection interrupted</h1>
        <p className="text-sm text-slate-400 mt-2">Your session could not be checked. Retrying automatically.</p>
        <Button className="mt-5" isLoading={retrying} onClick={() => setAttempt((value) => value + 1)}>Try again</Button>
      </div>
    </main>
  );
}
