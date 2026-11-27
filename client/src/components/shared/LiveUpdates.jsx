import { useEffect } from 'react';
import { useDispatch, useSelector, useStore } from 'react-redux';
import { useSocket } from '../../hooks/useSocket';
import { baseApi } from '../../api/baseApi';
import { orderViewTags } from '../../api/workspaceTags';
import { selectSessionEpoch, updateUser } from '../../features/auth/authSlice';

const orderEvents = [
  'order:new', 'order:assigned', 'order:unassigned', 'order:updated',
  'order:assignment_updated', 'order:cancelled', 'order:rejected',
  'order:status_updated', 'order:payment_submitted', 'order:payment_verified',
  'order:payment_rejected', 'packing:completed', 'packing:verified',
  'packing:rejected', 'packing:updated', 'delivery:assigned', 'delivery:unassigned',
];

export default function LiveUpdates() {
  const dispatch = useDispatch();
  const store = useStore();
  const epoch = useSelector(selectSessionEpoch);
  const { on } = useSocket();
  useEffect(() => {
    let timer;
    const pending = new Map();
    const clearPending = () => {
      clearTimeout(timer);
      timer = undefined;
      pending.clear();
    };
    // A single action often emits both an order event and a notification.
    // Use a fixed window (not a sliding debounce) so busy stores stay current.
    const invalidate = (tags) => {
      if (selectSessionEpoch(store.getState()) !== epoch) return;
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
    const refresh = (payload) => invalidate([
      ...orderViewTags(payload?.orderId),
      ...(payload?.orderId ? [{ type: 'Packing', id: payload.orderId }] : []),
    ]);
    const cleanups = orderEvents.map((event) => on(event, refresh));
    cleanups.push(on('user:updated', ({ user }) => {
      if (String(user?._id) !== String(store.getState().auth.user?._id)) return;
      clearPending();
      dispatch(updateUser(user));
      if (selectSessionEpoch(store.getState()) !== epoch) dispatch(baseApi.util.resetApiState());
    }));
    cleanups.push(on('data:changed', () => {
      invalidate(Object.keys(store.getState().api.provided.tags).map((type) => ({ type })));
    }));
    cleanups.push(on('notification:new', (payload) => {
      invalidate(notifications);
      if (payload?.notification?.data?.orderId) refresh(payload.notification.data);
    }));
    cleanups.push(on('connect', () => invalidate([
      ...orderViewTags(), ...notifications, { type: 'Packing' }, { type: 'CurrentUser' },
    ])));
    return () => {
      clearPending();
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [on, dispatch, store, epoch]);
  return null;
}
