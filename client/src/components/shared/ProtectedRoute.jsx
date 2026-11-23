import { Navigate, useLocation } from 'react-router-dom';
import { useSelector } from 'react-redux';
import {
  selectCurrentUser,
  selectIsAuthenticated,
  selectIsInitialized,
} from '../../features/auth/authSlice';
import { PageLoader } from '../ui/Spinner';
import { ROUTES } from '../../constants/routes';
import { hasEveryPermission } from '../../constants/permissions';

export default function ProtectedRoute({ children, allowedRoles, requiredPermissions }) {
  const user = useSelector(selectCurrentUser);
  const isAuthenticated = useSelector(selectIsAuthenticated);
  const isInitialized = useSelector(selectIsInitialized);
  const location = useLocation();

  if (!isInitialized) return <PageLoader />;

  if (!isAuthenticated) {
    return <Navigate to={ROUTES.LOGIN} state={{ from: location.pathname }} replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to={ROUTES.UNAUTHORIZED} replace />;
  }

  if (requiredPermissions?.length && !hasEveryPermission(user, requiredPermissions)) {
    return <Navigate to={ROUTES.UNAUTHORIZED} replace />;
  }

  return children;
}
