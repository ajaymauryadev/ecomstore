import { useEffect } from 'react';
import { useDispatch, useSelector, useStore } from 'react-redux';
import { useSocket } from '../../hooks/useSocket';
import { baseApi } from '../../api/baseApi';
import { orderViewTags } from '../../api/workspaceTags';
import { selectSessionEpoch, updateUser } from '../../features/auth/authSlice';
import { applyNotificationEvent } from '../../features/notifications/notificationApi';

const orderEvents = [
  'order:new', 'order:assigned', 'order:unassigned', 'order:updated',
  'order:assignment_updated', 'order:cancelled', 'order:rejected',
  'order:status_updated', 'order:payment_submitted', 'order:payment_verified',
  'order:payment_rejected', 'packing:completed', 'packing:verified',
  'packing:rejected', 'delivery:assigned', 'delivery:unassigned',
];

export default function LiveUpdates() {
  const dispatch = useDispatch();
  const store = useStore();
  const epoch = useSelector(selectSessionEpoch);
  const { on } = useSocket();
  useEffect(() => {
    let timer;
    let disposed = false;
    const pending = new Map();
    const clearPending = () => {
      clearTimeout(timer);
      timer = undefined;
      pending.clear();
    };
    // A single action often emits both an order event and a notification.
    // Use a fixed window (not a sliding debounce) so busy stores stay current.
    const invalidate = (tags) => {
      if (disposed || selectSessionEpoch(store.getState()) !== epoch) return;
      for (const tag of tags) pending.set(JSON.stringify([tag.type, tag.id]), tag);
      timer ??= setTimeout(() => {
        const tags = [...pending.values()];
        clearPending();
        if (selectSessionEpoch(store.getState()) === epoch) {
          dispatch(baseApi.util.invalidateTags(tags));
        }
      }, 75);
    };
    const notifications = [{ type: 'Notification' }];
    const seenNotifications = new Set();
    let notificationUpdates = Promise.resolve();
    const refresh = (payload) => invalidate([
      ...orderViewTags(payload?.orderId),
      ...(payload?.orderId ? [{ type: 'Packing', id: payload.orderId }] : []),
    ]);
    const refreshPacking = (payload) => invalidate([
      ...(payload?.orderId ? [{ type: 'Packing', id: payload.orderId }] : [{ type: 'Packing' }]),
      { type: 'Packing', id: 'ACTIVITY' }, { type: 'Packing', id: 'MISSING_REPORT' }, { type: 'Packing', id: 'HV_ALERTS' },
    ]);
    const cleanups = orderEvents.map((event) => on(event, refresh));
    cleanups.push(on('packing:updated', refreshPacking));
    cleanups.push(on('user:updated', ({ user }) => {
      if (String(user?._id) !== String(store.getState().auth.user?._id)) return;
      clearPending();
      dispatch(updateUser(user));
      if (selectSessionEpoch(store.getState()) !== epoch) dispatch(baseApi.util.resetApiState());
    }));
    cleanups.push(on('data:changed', (payload) => {
      const provided = Object.keys(store.getState().api.provided.tags);
      const types = Array.isArray(payload?.tags) && !payload.tags.includes('All')
        ? provided.filter((type) => payload.tags.includes(type)) : provided;
      invalidate(types.map((type) => ({ type })));
    }));
    cleanups.push(on('notification:new', (payload) => {
      notificationUpdates = notificationUpdates.then(() => {
        if (!disposed && selectSessionEpoch(store.getState()) === epoch) return applyNotificationEvent(store, payload?.notification, seenNotifications);
      }).catch(() => { /* The inbox refresh below recovers the persisted event. */ });
      invalidate(notifications);
      if (payload?.notification?.data?.orderId) {
        if (payload.notification.type === 'item_missing') refreshPacking(payload.notification.data);
        else refresh(payload.notification.data);
      }
    }));
    cleanups.push(on('connect', () => invalidate([
      ...orderViewTags(), ...notifications, { type: 'Packing' }, { type: 'CurrentUser' },
    ])));
    return () => {
      disposed = true;
      clearPending();
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [on, dispatch, store, epoch]);
  return null;
}
