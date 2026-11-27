import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import RouteContent from './RouteContent';
import { WorkspaceSyncStatus } from '../../offline/SavedDataStatus';
import { CreditCard, LayoutDashboard, LogOut, Menu, ScrollText, Shield, Store, X } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { ROUTES } from '../../constants/routes';
import { cn } from '../../utils/cn';

export const SUPER_ADMIN_NAV = [
  { label: 'Dashboard', icon: LayoutDashboard, to: ROUTES.SUPER_ADMIN.DASHBOARD },
  { label: 'All Stores', icon: Store, to: ROUTES.SUPER_ADMIN.STORES },
  { label: 'Plans', icon: CreditCard, to: ROUTES.SUPER_ADMIN.PLANS },
  { label: 'Audit Logs', icon: ScrollText, to: ROUTES.SUPER_ADMIN.AUDIT_LOGS },
];

function AdminNavigation({ user, logout, isLoggingOut, onNavigate }) {
  return <>
    <div className="flex items-center gap-3 h-16 px-5 border-b border-navy-700/60">
      <div className="w-8 h-8 bg-purple-500/20 rounded-lg flex items-center justify-center"><Shield size={18} className="text-purple-400" aria-hidden="true" /></div>
      <div><p className="font-bold text-slate-100 text-sm">Super Admin</p><p className="text-[11px] text-slate-500">System control</p></div>
    </div>
    <nav aria-label="Super admin navigation" className="flex-1 p-3 space-y-1 overflow-y-auto">
      {SUPER_ADMIN_NAV.map((item) => <NavLink key={item.to} to={item.to} onClick={onNavigate} className={({ isActive }) => cn('nav-item min-h-11', isActive && 'active')}><item.icon size={20} aria-hidden="true" /><span>{item.label}</span></NavLink>)}
    </nav>
    <div className="p-3 border-t border-navy-700/60 space-y-2">
      <div className="flex items-center gap-3 px-3 py-2 rounded-xl bg-navy-800/60"><div className="w-8 h-8 bg-purple-500/20 rounded-full flex items-center justify-center"><span className="text-xs font-bold text-purple-400">{user?.name?.[0]?.toUpperCase()}</span></div><div className="min-w-0"><p className="text-xs font-medium text-slate-200 truncate">{user?.name}</p><p className="text-[10px] text-slate-500">Super Admin</p></div></div>
      <button type="button" onClick={logout} disabled={isLoggingOut} className="nav-item min-h-11 w-full text-red-400 hover:text-red-300 hover:bg-red-500/10"><LogOut size={18} aria-hidden="true" /><span>Logout</span></button>
    </div>
  </>;
}

export default function SuperAdminLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, logout, isLoggingOut } = useAuth();

  return (
    <div className="min-h-screen bg-navy-950 flex">
      <aside className="hidden lg:flex w-64 bg-navy-900 border-r border-navy-700/60 flex-col shrink-0 sticky top-0 h-screen"><AdminNavigation user={user} logout={logout} isLoggingOut={isLoggingOut} /></aside>

      {mobileOpen && <div className="fixed inset-0 z-50 lg:hidden"><button type="button" aria-label="Close navigation overlay" className="absolute inset-0 w-full h-full bg-black/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} /><aside className="relative w-72 max-w-[85vw] h-full bg-navy-900 border-r border-navy-700/60 flex flex-col animate-slide-up"><button type="button" onClick={() => setMobileOpen(false)} aria-label="Close navigation" title="Close navigation" className="absolute right-2 top-2 min-w-11 min-h-11 inline-flex items-center justify-center rounded-xl text-slate-400 hover:bg-navy-700 z-10"><X size={20} /></button><AdminNavigation user={user} logout={logout} isLoggingOut={isLoggingOut} onNavigate={() => setMobileOpen(false)} /></aside></div>}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-navy-900/80 backdrop-blur-xl border-b border-navy-700/60 flex items-center justify-between px-4 sm:px-6 sticky top-0 z-40">
          <button type="button" onClick={() => setMobileOpen(true)} aria-label="Open navigation" title="Open navigation" className="lg:hidden min-w-11 min-h-11 inline-flex items-center justify-center rounded-xl hover:bg-navy-700 text-slate-400"><Menu size={21} /></button>
          <p className="text-sm font-semibold text-slate-200 lg:hidden">System control</p>
          <div className="ml-auto flex items-center gap-3"><WorkspaceSyncStatus /><div className="text-right"><p className="text-sm font-medium text-slate-200">{user?.name}</p><p className="text-[11px] text-purple-400">Super Admin</p></div></div>
        </header>
        <main id="main-content" className="page-width flex-1 py-4 sm:py-6"><RouteContent><Outlet /></RouteContent></main>
      </div>
    </div>
  );
}
