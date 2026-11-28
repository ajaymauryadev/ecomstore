import { useState, useRef, useEffect, useCallback } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { Bell, X, Check, CheckCheck, ShoppingCart, CreditCard, AlertTriangle, Package, User } from 'lucide-react';
import toast from 'react-hot-toast';
import { useGetUnreadCountQuery, useGetNotificationsQuery, useMarkReadMutation, useMarkAllReadMutation } from '../../features/notifications/notificationApi';
import { selectCurrentUser } from '../../features/auth/authSlice';
import { notificationTarget } from '../../utils/notificationTarget';
import { useSocket } from '../../hooks/useSocket';
import { cn } from '../../utils/cn';
import { formatDistanceToNow } from 'date-fns';

const TYPE_ICON = { new_order: ShoppingCart, payment_submitted: CreditCard, order_cancelled: X, low_stock: AlertTriangle, item_missing: Package, stock_mismatch: AlertTriangle, order_assigned: User, payment_verified: Check };
const refreshOptions = { pollingInterval: 0 };

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const triggerRef = useRef(null);
  const seen = useRef(new Set());
  const initialized = useRef(false);
  const popupIds = useRef([]);
  const user = useSelector(selectCurrentUser);
  const navigate = useNavigate();
  const { on, connected } = useSocket();
  const { data: countData } = useGetUnreadCountQuery(undefined, refreshOptions);
  // Keep a small inbox current even while closed, so polling can recover missed events.
  const { data: notifData, isLoading, isError, refetch } = useGetNotificationsQuery({ limit: 20 }, refreshOptions);
  const [markRead] = useMarkReadMutation();
  const [markAllRead] = useMarkAllReadMutation();
  const count = countData?.data?.count ?? 0;
  const notifications = notifData?.data ?? [];

  const viewNotification = useCallback((notification) => {
    setOpen(false);
    if (!notification.isRead) markRead(notification._id);
    const to = notificationTarget(user, notification);
    if (to) navigate(to);
  }, [markRead, navigate, user]);

  const alertNotification = useCallback((notification) => {
    if (!notification?._id || seen.current.has(notification._id)) return;
    seen.current.add(notification._id);
    if (notification.isRead || open) return;
    // Also guard the client inbox if a stale or misrouted event arrives.
    if (notification.userId && String(notification.userId) !== String(user?._id)) return;
    if (!notification.userId && notification.role !== (user?.role === 'store_owner' ? 'admin' : 'staff')) return;
    const popupId = 'notification-' + notification._id;
    popupIds.current.push(popupId);
    while (popupIds.current.length > 3) toast.dismiss(popupIds.current.shift());
    toast((instance) => (
      <div className="flex min-w-0 items-start gap-3" data-testid="notification-popup">
        <Bell size={18} className="shrink-0 mt-0.5 text-blue-700" aria-hidden="true" />
        <div className="min-w-0 notification-copy">
          <p className="font-semibold break-words">{notification.title}</p>
          {notification.body && <p className="text-sm mt-1 line-clamp-3 break-words">{notification.body}</p>}
          {notification.data?.orderId && <button type="button" className="mt-2 min-h-9 font-semibold text-blue-700" onClick={() => { toast.dismiss(instance.id); viewNotification(notification); }}>View order</button>}
        </div>
        <button type="button" aria-label="Dismiss notification" className="min-h-9 min-w-9 grid place-items-center shrink-0" onClick={() => toast.dismiss(instance.id)}><X size={16} /></button>
      </div>
    ), { id: popupId, duration: 6000, style: { maxWidth: 'calc(100vw - 2rem)', width: '24rem', overflowWrap: 'anywhere' } });
  }, [user?._id, user?.role, viewNotification, open]);

  useEffect(() => {
    popupIds.current.forEach((id) => toast.dismiss(id));
    popupIds.current = [];
    seen.current = new Set();
    initialized.current = false;
  }, [user?._id]);

  useEffect(() => on('notification:new', ({ notification }) => alertNotification(notification)), [on, alertNotification]);
  useEffect(() => {
    if (!notifData) return;
    if (!initialized.current) {
      for (const notification of notifData.data ?? []) seen.current.add(notification._id);
      initialized.current = true;
      return;
    }
    for (const notification of [...(notifData.data ?? [])].reverse()) alertNotification(notification);
  }, [notifData, alertNotification]);

  useEffect(() => {
    const dismiss = (event) => { if (ref.current && !ref.current.contains(event.target)) setOpen(false); };
    const escape = (event) => { if (event.key === 'Escape' && open) { setOpen(false); triggerRef.current?.focus(); } };
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', dismiss); document.removeEventListener('keydown', escape); };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button ref={triggerRef} type="button" onClick={() => {
        if (!open) for (const id of seen.current) toast.dismiss('notification-' + id);
        setOpen((value) => !value);
      }} aria-label="Notifications" aria-expanded={open}
        className="relative grid h-11 w-11 place-items-center rounded-xl hover:bg-navy-700/60 text-slate-400 hover:text-slate-100 transition-colors">
        <Bell size={20} aria-hidden="true" />
        <span role="status" aria-label={connected ? 'Live updates connected' : 'Live updates reconnecting'} className={cn('absolute bottom-2 right-2 h-1.5 w-1.5 rounded-full', connected ? 'bg-emerald-600' : 'bg-amber-600')} />
        {count > 0 && <span data-testid="notification-unread-count" className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-red-600 rounded-full text-[10px] font-bold text-white flex items-center justify-center px-0.5">{count > 99 ? '99+' : count}</span>}
      </button>
      {open && (
        <section aria-label="Notification inbox" className="notification-inbox fixed right-4 top-16 mt-2 w-[min(26rem,calc(100vw-2rem))] bg-navy-800 border border-navy-700 rounded-2xl shadow-xl z-50 overflow-hidden sm:absolute sm:right-0 sm:top-full">
          <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-3 border-b border-navy-700/60">
            <h2 className="font-semibold text-slate-100 text-base min-w-0 flex-1">Notifications <span className="block text-xs text-slate-500 font-normal">{count} unread</span></h2>
            {count > 0 && <button type="button" onClick={() => markAllRead()} className="min-h-11 flex items-center gap-1 text-xs text-gold-400"><CheckCheck size={14} /> Mark all read</button>}
          </div>
          <div className="min-h-0 max-h-96 overflow-y-auto">
            {isLoading ? <p role="status" className="p-6 text-sm text-slate-400">Loading notifications…</p> : isError ? <div role="alert" className="p-5 text-sm"><p>Notifications could not be loaded.</p><button type="button" onClick={refetch} className="btn-secondary mt-3">Try again</button></div> : !notifications.length ? <p className="py-12 text-center text-slate-500 text-sm">No notifications yet</p> : notifications.map((notification) => {
              const Icon = TYPE_ICON[notification.type] || Bell;
              return <button key={notification._id} type="button" onClick={() => viewNotification(notification)} className={cn('w-full flex gap-3 px-4 py-4 text-left hover:bg-navy-700/40 transition-colors border-b border-navy-700 last:border-0', !notification.isRead && 'bg-gold-500/5')}>
                <span className="w-9 h-9 rounded-xl bg-gold-500/10 text-gold-400 grid place-items-center shrink-0"><Icon size={16} aria-hidden="true" /></span>
                <span className="flex-1 min-w-0 notification-copy"><span className="block text-sm font-semibold text-slate-100">{notification.title}</span>{notification.body && <span className="block text-sm text-slate-400 mt-1 break-words">{notification.body}</span>}<span className="block text-xs text-slate-500 mt-2">{formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}</span></span>
                {!notification.isRead && <span className="w-2 h-2 bg-gold-500 rounded-full shrink-0 mt-2" aria-label="Unread" />}
              </button>;
            })}
          </div>
          <button type="button" className="w-full shrink-0 min-h-12 text-sm font-semibold text-gold-400 border-t border-navy-700 bg-navy-750" onClick={() => { setOpen(false); navigate('/store/notifications'); }}>View all notifications</button>
        </section>
      )}
    </div>
  );
}
