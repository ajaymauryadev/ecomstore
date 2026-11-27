import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import {
  selectCurrentUser,
  selectCurrentStore,
  selectIsAuthenticated,
  selectAccessToken,
  selectUserRole,
} from '../features/auth/authSlice';
import { useGetMeQuery, useLogoutMutation } from '../features/auth/authApi';
import { dashboardRouteForRole, ROUTES } from '../constants/routes';
import { ROLES } from '../constants/roles';
import { hasPermission as userHasPermission } from '../constants/permissions';

export const useAuth = () => {
  const navigate = useNavigate();
  const user = useSelector(selectCurrentUser);
  const store = useSelector(selectCurrentStore);
  const isAuthenticated = useSelector(selectIsAuthenticated);
  const accessToken = useSelector(selectAccessToken);
  const role = useSelector(selectUserRole);
  const [logoutMutation, { isLoading: isLoggingOut }] = useLogoutMutation();
  useGetMeQuery(undefined, {
    skip: !accessToken,
    pollingInterval: 60000, skipPollingIfUnfocused: true,
    refetchOnFocus: true, refetchOnReconnect: true,
  });

  const logout = async () => {
    try {
      await logoutMutation().unwrap();
    } finally {
      navigate(ROUTES.LOGIN, { replace: true });
    }
  };

  const getDashboardRoute = () => dashboardRouteForRole(role);

  const hasRole = (...roles) => roles.includes(role);

  const hasPermission = (permission) => userHasPermission(user, permission);

  return {
    user,
    store,
    role,
    isAuthenticated,
    accessToken,
    isLoggingOut,
    logout,
    getDashboardRoute,
    hasRole,
    hasPermission,
    isSuperAdmin: role === ROLES.SUPER_ADMIN,
    isStoreOwner: role === ROLES.STORE_OWNER,
    isStaff: role === ROLES.STAFF || role === ROLES.PACKER || role === ROLES.DELIVERY,
    isCustomer: role === ROLES.CUSTOMER,
  };
};
