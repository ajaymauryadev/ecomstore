import { Link, Navigate, useLocation } from 'react-router-dom';
import { useSelector } from 'react-redux';
import {
  selectCurrentUser,
  selectIsAuthenticated,
  selectIsInitialized,
} from '../../features/auth/authSlice';
import StartupShell from '../layout/StartupShell';
import { ROUTES } from '../../constants/routes';
import { hasEveryPermission } from '../../constants/permissions';

export default function ProtectedRoute({ children, allowedRoles, requiredPermissions }) {
  const user = useSelector(selectCurrentUser);
  const isAuthenticated = useSelector(selectIsAuthenticated);
  const isInitialized = useSelector(selectIsInitialized);
  const offlineSession = useSelector((state) => state.auth.offlineSession);
  const logoutPending = useSelector((state) => state.savedData?.logoutPending);
  const location = useLocation();

  if (logoutPending && !user) return <Navigate to={ROUTES.LOGIN} state={{ from: location.pathname }} replace />;
  if (!isInitialized || logoutPending) return <StartupShell />;

  // A time-limited local identity unlocks saved work when offline. While online,
  // wait for cookie refresh before showing sensitive data from that identity.
  if (offlineSession && navigator.onLine !== false) return <StartupShell>
    <p role="status">Confirming access to this workspace. Saved data will open when your session is verified.</p>
  </StartupShell>;

  if (!isAuthenticated) {
    return <Navigate to={ROUTES.LOGIN} state={{ from: location.pathname }} replace />;
  }

  const denied = (allowedRoles && !allowedRoles.includes(user.role)) ||
    (requiredPermissions?.length && !hasEveryPermission(user, requiredPermissions));
  if (denied) {
    // A cached identity can belong to the previous login. Keep the requested
    // route while AuthInit confirms the cookie, without rendering its private UI.
    if (offlineSession) return <StartupShell>
      <p role="status">Confirming access to this workspace. Connect to the internet to verify your session.</p>
      <Link className="btn-secondary mt-4" to={ROUTES.LOGIN} state={{ from: location.pathname }}>Sign in with another account</Link>
    </StartupShell>;
    return <Navigate to={ROUTES.UNAUTHORIZED} replace />;
  }

  return children;
}
