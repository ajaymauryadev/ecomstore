import { useNavigationPrefetch } from '../../hooks/useNavigationPrefetch';
import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, MoreHorizontal, LogOut, Menu, Store } from 'lucide-react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { cn } from '../../utils/cn';
import Modal from '../ui/Modal';
import MobileNavigation from './MobileNavigation';
import RouteContent from './RouteContent';
import { WorkspaceTheme } from './WorkspaceTheme';
import './workspace.css';

function Navigation({ sections, badges, compact, onNavigate, label, accordion = false }) {
  const { pathname } = useLocation();
  const activeItem = sections.flatMap(({ items }) => items)
    .filter((item) => pathname === item.to || (!item.end && pathname.startsWith(item.to + '/')))
    .sort((a, b) => b.to.length - a.to.length)[0];
  const activeSection = sections.find(({ items }) => items.includes(activeItem))?.label;
  const [expanded, setExpanded] = useState(activeSection || sections[0]?.label);
  useEffect(() => { if (activeSection) setExpanded(activeSection); }, [pathname, activeSection]);
  const grouped = accordion && !compact;
  const links = (items) => items.map(({ label: name, icon: Icon, to, badgeKey, end }) => (
    <NavLink key={to} to={to} end={end} onClick={onNavigate}
      aria-label={compact ? name : undefined} title={compact ? name : undefined}
      className={({ isActive }) => cn('nav-item', isActive && 'active', compact && 'justify-center px-1')}>
      <Icon size={18} className="shrink-0" aria-hidden="true" />
      {!compact && <><span className="flex-1 min-w-0">{name}</span>
        {badges[badgeKey] > 0 && <span className="badge bg-gold-500/10 text-gold-400 tabular-nums">{badges[badgeKey]}</span>}
      </>}
    </NavLink>
  ));
  if (grouped) {
    const currentSection = sections.find((section) => section.label === expanded) || sections[0];
    return <nav aria-label={label} className="workspace-navigation flex-1 min-h-0">
      <div role="group" aria-label={`${label} sections`} className="workspace-section-rail">
        {sections.map(({ label: section, icon: Icon }) => <button type="button" key={section}
          title={section} aria-label={section} aria-pressed={currentSection?.label === section}
          className={cn('workspace-rail-button', currentSection?.label === section && 'is-selected')}
          onClick={() => setExpanded(section)}>
          {Icon && <Icon size={20} strokeWidth={1.7} aria-hidden="true" />}
          <span className="workspace-rail-tooltip">{section}</span>
        </button>)}
      </div>
      <div className="workspace-section-panel">
        <div className="workspace-panel-heading"><p className="text-xs text-slate-500">WORKSPACE</p><h2>{currentSection?.label}</h2></div>
        <div className="space-y-1">{links(currentSection?.items || [])}</div>
      </div>
    </nav>;
  }
  return <nav aria-label={label} className="flex-1 min-h-0 p-3 space-y-4 overflow-y-auto">
    {sections.map(({ label: section, items }) => {
      return <div key={section} className="space-y-0.5">
        {!compact && section && <p className="px-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">{section}</p>}
        <div>{links(items)}</div>
      </div>;
    })}
  </nav>;
}

export default function WorkspaceFrame({ sections, accordionNavigation = false, user, store, logout, isLoggingOut, badges = {}, notifications, staffTabs = false, mobileItems = [] }) {
  const prefetchHandlers = useNavigationPrefetch();
  const [compact, setCompact] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const closeDrawer = useCallback(() => setDrawer(false), []);
  useEffect(() => {
    if (!drawer) return;
    const desktop = window.matchMedia('(min-width: 1024px)');
    const closeAtDesktop = (event) => { if (event.matches) closeDrawer(); };
    desktop.addEventListener('change', closeAtDesktop);
    return () => desktop.removeEventListener('change', closeAtDesktop);
  }, [drawer, closeDrawer]);
  const name = store?.name || 'Smart Kirana';
  const { pathname } = useLocation();
  const activePage = sections.flatMap((section) => section.items)
    .filter((item) => pathname === item.to || pathname.startsWith(item.to + '/'))
    .sort((a, b) => b.to.length - a.to.length)[0]?.label || 'Workspace';
  const navLabel = staffTabs ? 'Staff navigation' : 'Store navigation';
  const moreItem = { label: 'More', icon: MoreHorizontal, onClick: () => setDrawer(true), expanded: drawer, active: drawer };
  const hasExtraTools = staffTabs && sections.length > 1;
  const staffItems = mobileItems.length ? mobileItems : (sections[0]?.items || []);
  const bottomItems = staffTabs ? (hasExtraTools ? [...staffItems.slice(0, 4), moreItem] : staffItems) : [
    ...mobileItems,
    { label: 'More', icon: MoreHorizontal, onClick: () => setDrawer(true), expanded: drawer, active: drawer },
  ];
  const logoutButton = (iconOnly) => (
    <button type="button" onClick={logout} disabled={isLoggingOut} aria-label="Log out" title={iconOnly ? 'Log out' : undefined}
      className={cn('nav-item w-full text-slate-400', iconOnly && 'justify-center px-2')}>
      <LogOut size={18} aria-hidden="true" />
      {!iconOnly && 'Log out'}
    </button>
  );
  return (
    <WorkspaceTheme.Provider value>
      <div className={"workspace-theme workspace-shell flex"} {...prefetchHandlers}>
        <a href="#workspace-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-2 focus:z-50 btn btn-primary">Skip to main content</a>
        <aside className={cn('workspace-sidebar hidden shrink-0 flex-col border-r lg:flex', compact ? 'w-[4.5rem]' : accordionNavigation ? 'w-[17.5rem]' : 'w-60')}>
          <div className={cn('flex gap-3 border-b border-navy-700 p-4', compact ? 'flex-col items-center' : 'items-center')}>
            <span className="workspace-mark grid h-10 w-10 shrink-0 place-items-center rounded-xl"><Store size={20} aria-hidden="true" /></span>
            {!compact && <p className="workspace-wordmark flex-1 truncate text-sm">{name}</p>}
            <button type="button" aria-label={compact ? 'Expand navigation' : 'Collapse navigation'}
              onClick={() => setCompact((value) => !value)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-navy-700">
              <ChevronLeft size={17} className={cn(compact && 'rotate-180')} aria-hidden="true" />
            </button>
          </div>
          <Navigation sections={sections} accordion={accordionNavigation} badges={badges} compact={compact} label={navLabel} />
          <div className="border-t border-navy-700 p-3">{logoutButton(compact)}</div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="workspace-header sticky top-0 z-40 flex items-center gap-3 border-b px-4 sm:px-6">
            {(!staffTabs || hasExtraTools) && (
              <button type="button" onClick={() => setDrawer(true)} aria-label="Open navigation" aria-expanded={drawer}
                className="workspace-row-action workspace-menu-trigger text-slate-400">
                <Menu size={21} aria-hidden="true" />
              </button>
            )}
            <div className="min-w-0 flex-1 text-sm">
              <p className="workspace-wordmark truncate lg:hidden">{name}</p>
              <p className="hidden lg:flex items-center gap-2 text-slate-500"><span>{staffTabs ? 'Team workspace' : 'Store workspace'}</span><ChevronRight size={14} aria-hidden="true" /><span className="font-semibold text-slate-200">{activePage}</span></p>
            </div>
            {notifications}
            <div className="flex shrink-0 items-center gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-gold-500/10 text-sm font-bold text-gold-400" aria-hidden="true">
                {user?.name?.[0]?.toUpperCase()}
              </span>
              <div className="hidden sm:block">
                <p className="text-sm font-semibold truncate max-w-40">{user?.name}</p>
                <p className="text-xs capitalize text-slate-500">{user?.role?.replaceAll('_', ' ')}</p>
              </div>
            </div>
            {staffTabs && <div className="lg:hidden">{logoutButton(true)}</div>}
          </header>
          <main id="workspace-content" tabIndex={-1} className="page-width workspace-main flex-1">
            <RouteContent><Outlet /></RouteContent>
          </main>
        </div>

        <MobileNavigation label={staffTabs ? navLabel : "Store shortcuts"} items={bottomItems}
          className="fixed inset-x-0 bottom-0 z-40 lg:hidden" />
        {(!staffTabs || hasExtraTools) && (
          <Modal title={name} isOpen={drawer} onClose={closeDrawer} className="workspace-drawer" overlayClassName="workspace-drawer-overlay lg:hidden">
            <Navigation sections={sections} accordion={accordionNavigation} badges={badges} onNavigate={closeDrawer} label={navLabel} />
            {logoutButton(false)}
          </Modal>
        )}
      </div>
    </WorkspaceTheme.Provider>
  );
}
