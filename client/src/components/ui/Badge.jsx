import { cn } from '../../utils/cn';

const variants = {
  default: 'bg-navy-700 text-slate-300 border-navy-600',
  gold: 'text-gold-400 bg-gold-500/10 border-gold-500/20',
  success: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  danger: 'text-red-400 bg-red-500/10 border-red-500/20',
  warning: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  info: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  purple: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
};

const statusMap = {
  active: 'success',
  inactive: 'danger',
  pending: 'warning',
  completed: 'success',
  cancelled: 'danger',
  processing: 'info',
  paid: 'success',
  unpaid: 'danger',
  partial: 'warning',
  low_stock: 'warning',
  out_of_stock: 'danger',
  in_stock: 'success',
};

export default function Badge({ children, variant = 'default', status, dot = false, className }) {
  const v = status ? statusMap[status] || 'default' : variant;

  return (
    <span className={cn('badge border', variants[v], className)}>
      {dot && (
        <span className={cn('w-1.5 h-1.5 rounded-full bg-current')} />
      )}
      {children}
    </span>
  );
}
