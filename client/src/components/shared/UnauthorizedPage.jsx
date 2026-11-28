import { Link, Navigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { ShieldAlert } from 'lucide-react';
import { selectCurrentUser, selectCurrentStore, selectIsAuthenticated, selectIsInitialized } from '../../features/auth/authSlice';
import { dashboardRouteForRole, ROUTES } from '../../constants/routes';
import { PageLoader } from '../ui/Spinner';

export default function UnauthorizedPage() {
  const user = useSelector(selectCurrentUser);
  const store = useSelector(selectCurrentStore);
  const isAuthenticated = useSelector(selectIsAuthenticated);
  const isInitialized = useSelector(selectIsInitialized);
  if (!isInitialized) return <PageLoader />;
  if (!isAuthenticated) return <Navigate to={ROUTES.LOGIN} replace />;

  const customerStore = user.role === 'customer' && store?.slug;
  const destination = customerStore ? ROUTES.STOREFRONT(store.slug) : dashboardRouteForRole(user.role);
  return (
    <main className="workspace-theme min-h-screen bg-navy-950 flex items-center justify-center p-6">
      <div className="card max-w-md p-8 text-center">
        <ShieldAlert aria-hidden="true" size={48} className="mx-auto mb-4 text-red-400" />
        <h1 className="text-xl font-bold text-slate-100">Access denied</h1>
        <p className="text-slate-400 text-sm mt-2">You do not have permission to view this page.</p>
        <Link to={destination} replace className="mt-6 inline-flex rounded-xl bg-gold-500 px-5 py-3 font-semibold text-navy-950">
          {customerStore ? 'Back to store' : destination === ROUTES.LOGIN ? 'Sign in' : 'Back to dashboard'}
        </Link>
      </div>
    </main>
  );
}
