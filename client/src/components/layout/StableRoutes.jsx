import { Suspense, useDeferredValue } from 'react';
import { Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { selectSessionEpoch } from '../../features/auth/authSlice';
import StartupShell from './StartupShell';
import { SavedScroll } from '../../offline/SavedDataStatus';

function CommittedRoute() {
  // Restore scroll only after the destination is ready, never while its old
  // page is still displayed during a deferred navigation.
  return <><SavedScroll /><Outlet /></>;
}

export default function StableRoutes({ children }) {
  const location = useLocation();
  const deferredLocation = useDeferredValue(location);
  const epoch = useSelector(selectSessionEpoch);
  // A slow page chunk must not replace an already visible screen. Changing
  // accounts still resets the boundary immediately, including its old content.
  return <Suspense key={epoch} fallback={<StartupShell />}>
    <Routes location={deferredLocation}><Route element={<CommittedRoute />}>{children}</Route></Routes>
  </Suspense>;
}
