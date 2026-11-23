import { useSelector } from 'react-redux';
import { selectCurrentUser } from '../../features/auth/authSlice';
import { hasAnyPermission } from '../../constants/permissions';

export default function RoleGuard({ roles, permissions, fallback = null, children }) {
  const user = useSelector(selectCurrentUser);
  if (!user) return fallback;

  if (roles && !roles.includes(user.role)) return fallback;

  if (permissions) {
    if (!hasAnyPermission(user, permissions)) return fallback;
  }

  return children;
}
