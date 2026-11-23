import { Store, Users, CreditCard, TrendingUp, ArrowUpRight, AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { KPICard } from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import { useAuth } from '../../hooks/useAuth';
import { formatTimeAgo } from '../../utils/formatters';
import { ROUTES } from '../../constants/routes';
import { useGetSystemStatsQuery } from '../../features/superAdmin/superAdminApi';
import { SkeletonKPI } from '../../components/ui/Skeleton';
import { cn } from '../../utils/cn';

const PLAN_COLORS = { trial: 'default', basic: 'info', premium: 'gold', enterprise: 'purple' };

export default function SuperAdminDashboard() {
  const { user } = useAuth();
  const { data, isLoading } = useGetSystemStatsQuery(undefined, { pollingInterval: 60000 });

  const stats = data?.data;
  const planDist = stats?.planDistribution ?? [];
  const recentStores = stats?.recentStores ?? [];

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold text-slate-100">System Overview</h1>
        <p className="text-slate-400 text-sm mt-0.5">
          Welcome back, {user?.name} &middot; {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {isLoading ? (
          [0, 1, 2, 3].map((i) => <SkeletonKPI key={i} />)
        ) : (
          <>
            <KPICard title="Total Stores" value={stats?.totalStores ?? 0} icon={<Store size={20} />} color="gold" />
            <KPICard title="Active Stores" value={stats?.activeStores ?? 0} icon={<TrendingUp size={20} />} color="green" />
            <KPICard title="Total Users" value={stats?.totalUsers ?? 0} icon={<Users size={20} />} color="blue" />
            <KPICard title="Expiring Soon" value={stats?.expiringThisWeek ?? 0} icon={<AlertTriangle size={20} />} color="purple" />
          </>
        )}
      </div>

      {/* Recent stores + Plan distribution */}
      <div className="grid lg:grid-cols-2 gap-5">
        <div className="card p-0 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-navy-700/60">
            <div className="flex items-center gap-2">
              <Store size={18} className="text-gold-400" />
              <h3 className="font-semibold text-slate-100">Recent Stores</h3>
            </div>
            <Link to={ROUTES.SUPER_ADMIN.STORES} className="text-xs text-gold-500 hover:text-gold-400 flex items-center gap-1">
              View all <ArrowUpRight size={12} />
            </Link>
          </div>
          {isLoading ? (
            <div className="divide-y divide-navy-700/40">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-4 px-5 py-3.5 animate-pulse">
                  <div className="w-9 h-9 rounded-xl bg-navy-700 shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 bg-navy-700 rounded w-2/3" />
                    <div className="h-2.5 bg-navy-700/60 rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="divide-y divide-navy-700/40">
              {recentStores.length === 0 ? (
                <div className="py-10 text-center text-slate-500 text-sm">No stores yet</div>
              ) : recentStores.map((store) => (
                <Link key={store._id} to={`/super-admin/stores/${store._id}`} className="flex items-center gap-4 px-5 py-3.5 hover:bg-navy-700/20 transition-colors">
                  <div className="w-9 h-9 rounded-xl bg-gradient-gold flex items-center justify-center shrink-0">
                    <span className="text-navy-950 font-bold text-sm">{store.name[0]}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-200 truncate">{store.name}</p>
                    <p className="text-xs text-slate-500">/{store.slug} &middot; {formatTimeAgo(store.createdAt)}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge variant={PLAN_COLORS[store.subscription?.plan] || 'default'}>{store.subscription?.plan || 'trial'}</Badge>
                    <Badge status={store.isActive ? 'active' : 'inactive'} dot>{store.isActive ? 'active' : 'inactive'}</Badge>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="card p-5">
          <div className="flex items-center gap-2 mb-5">
            <CreditCard size={18} className="text-purple-400" />
            <h3 className="font-semibold text-slate-100">Plan Distribution</h3>
          </div>
          {isLoading ? (
            <div className="grid grid-cols-2 gap-3">
              {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 bg-navy-700/40 rounded-xl animate-pulse" />)}
            </div>
          ) : planDist.length === 0 ? (
            <p className="text-slate-500 text-sm text-center py-8">No plan data yet</p>
          ) : (
            <div className="space-y-3">
              {planDist.map((p) => {
                const total = planDist.reduce((s, x) => s + x.count, 0);
                const pct = total > 0 ? Math.round((p.count / total) * 100) : 0;
                const colors = { trial: 'bg-slate-500', basic: 'bg-blue-500', premium: 'bg-gold-500', enterprise: 'bg-purple-500' };
                return (
                  <div key={p._id} className="flex items-center gap-3">
                    <span className="text-xs text-slate-400 w-20 capitalize">{p._id || 'unknown'}</span>
                    <div className="flex-1 h-2 bg-navy-700 rounded-full overflow-hidden">
                      <div className={cn('h-full rounded-full transition-all', colors[p._id] || 'bg-slate-500')} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs font-semibold text-slate-300 w-12 text-right">{p.count} ({pct}%)</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
