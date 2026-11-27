import Pagination from '../../components/ui/Pagination';
import { usePageSize, usePageState } from '../../hooks/usePagination';
import OrderResponsibility from '../../components/orders/OrderResponsibility';
import { useState } from 'react';
import { CheckCircle2, Clock, MapPin, PackageCheck, Phone, RefreshCw, Truck } from 'lucide-react';
import toast from 'react-hot-toast';
import { useGetDeliveryOrdersQuery, useUpdateDeliveryStatusMutation } from '../../features/delivery/deliveryApi';
import { formatCurrency, formatTimeAgo } from '../../utils/formatters';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import EmptyState from '../../components/ui/EmptyState';
import Modal from '../../components/ui/Modal';
import { useAuth } from '../../hooks/useAuth';
import { hasPermission, PERMISSIONS } from '../../constants/permissions';

const addressText = (address = {}) => [address.line1, address.landmark, address.city, address.state, address.pincode].filter(Boolean).join(', ');

export default function DeliveryOrdersPage() {
  const { user } = useAuth();
  const managesAll = hasPermission(user, PERMISSIONS.DELIVERY_MANAGE);
  const canUpdate = hasPermission(user, PERMISSIONS.DELIVERY_UPDATE);
  const { limit } = usePageSize('cards');
  const [page, setPage] = usePageState(limit);
  const [confirmation, setConfirmation] = useState(null);
  const { data, isLoading, isError, isFetching, refetch } = useGetDeliveryOrdersQuery({ page, limit }, {
    pollingInterval: 0, skipPollingIfUnfocused: true, refetchOnFocus: true, refetchOnReconnect: true,
  });
  const [updateStatus, { isLoading: updating }] = useUpdateDeliveryStatusMutation();
  const orders = data?.data || [];
  const meta = data?.meta || {};

  const confirmUpdate = async () => {
    try {
      await updateStatus(confirmation).unwrap();
      toast.success(confirmation.status === 'delivered' ? 'Delivery completed.' : 'Order marked out for delivery.');
      setConfirmation(null);
    } catch (error) {
      toast.error(error?.data?.message || 'Delivery status could not be updated.');
    }
  };

  return (
    <div className="space-y-5" aria-busy={isFetching}>
      <div className="page-header"><div><h1 className="page-title">{managesAll ? 'Deliveries' : 'My deliveries'}</h1><p className="text-sm text-slate-400 mt-1">{meta.total ?? orders.length} order{(meta.total ?? orders.length) === 1 ? '' : 's'} · {managesAll ? 'All store deliveries' : 'Your assigned deliveries'}</p></div><button type="button" onClick={refetch} className="workspace-row-action text-slate-400" aria-label="Refresh deliveries" title="Refresh deliveries"><RefreshCw size={18} className={isFetching && !data ? 'animate-spin' : ''} /></button></div>

      {isLoading ? <div className="grid gap-3">{[1, 2, 3].map((item) => <div key={item} className="h-48 card animate-pulse" />)}</div> : isError ? (
        <EmptyState icon={Truck} title="Deliveries could not be loaded" description="Check the connection and try again." action={<Button size="sm" variant="secondary" onClick={refetch}>Retry</Button>} />
      ) : orders.length === 0 ? (
        <EmptyState icon={CheckCircle2} title={managesAll ? 'No deliveries' : 'No assigned deliveries'} description={managesAll ? 'Delivery orders will appear here without a staff assignment.' : 'Your owner will assign packed delivery orders here.'} />
      ) : <div className="grid gap-3 lg:grid-cols-2">{orders.map((order) => {
        const address = addressText(order.customerInfo?.address);
        const canStart = canUpdate && ['packed', 'partially_fulfilled'].includes(order.status);
        const canFinish = canUpdate && order.status === 'out_for_delivery';
        return <article key={order._id} className="card p-5 space-y-4">
          <div className="flex items-start justify-between gap-3"><div><p className="font-mono text-xs text-slate-500">{order.orderNumber}</p><h2 className="font-semibold text-slate-100">{order.customerInfo?.name || 'Customer'}</h2></div><div className="text-right"><p className="font-bold text-gold-400">{formatCurrency(order.pricing?.grandTotal || 0)}</p><Badge status={order.status}>{order.status?.replaceAll('_', ' ')}</Badge></div></div>
          <div className="space-y-2 text-sm text-slate-300">
            <a href={`tel:${order.customerInfo?.phone}`} className="min-h-11 flex items-center gap-2 rounded-xl bg-navy-900/50 px-3 hover:text-gold-400"><Phone size={15} aria-hidden="true" /><span>{order.customerInfo?.phone}</span></a>
            <div className="min-h-11 flex items-start gap-2 rounded-xl bg-navy-900/50 px-3 py-3"><MapPin size={15} className="mt-0.5 shrink-0" aria-hidden="true" /><span>{address || 'Address unavailable'}</span></div>
          </div>
          <div className="flex items-center justify-between text-xs text-slate-500"><span>{order.items?.reduce((sum, item) => sum + item.quantity, 0) || 0} items</span><span>{formatTimeAgo(order.createdAt)}</span></div>
          <OrderResponsibility order={order} compact />
          {['pending', 'payment_pending', 'payment_submitted', 'accepted', 'payment_verified', 'packing'].includes(order.status) && <p className="packing-waiting-note">
            <Clock size={15} className="shrink-0" aria-hidden="true" />
            {order.status === 'pending' ? 'The assigned packer or store owner must accept this order before packing.'
              : ['payment_pending', 'payment_submitted'].includes(order.status) ? 'Waiting for payment verification by the owner or payment verifier.'
                : 'The packing team is preparing this order. Delivery becomes available once it is packed.'}
          </p>}
          {canStart && <Button fullWidth leftIcon={<Truck size={17} />} onClick={() => setConfirmation({ orderId: order._id, status: 'out_for_delivery', orderNumber: order.orderNumber })}>Start delivery</Button>}
          {canFinish && <Button fullWidth leftIcon={<PackageCheck size={17} />} onClick={() => setConfirmation({ orderId: order._id, status: 'delivered', orderNumber: order.orderNumber })}>Confirm delivered</Button>}
        </article>;
      })}</div>}

      <Pagination meta={meta} page={page} onPageChange={setPage} isFetching={isFetching} label="deliveries" />

      <Modal isOpen={Boolean(confirmation)} onClose={() => setConfirmation(null)} title={confirmation?.status === 'delivered' ? 'Confirm delivery' : 'Start delivery'} size="sm">
        <p className="text-sm text-slate-300">{confirmation?.status === 'delivered' ? `Confirm ${confirmation?.orderNumber} was handed to the customer. This records delivery and completes any COD payment.` : `Mark ${confirmation?.orderNumber} as out for delivery?`}</p>
        <div className="flex gap-3 mt-5"><Button variant="secondary" fullWidth onClick={() => setConfirmation(null)}>Cancel</Button><Button fullWidth isLoading={updating} onClick={confirmUpdate}>Confirm</Button></div>
      </Modal>
    </div>
  );
}
