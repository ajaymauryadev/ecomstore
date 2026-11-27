import { cn } from '../../utils/cn';

export default function Card({ children, className, hover = false, padding = true, ...props }) {
  return (
    <div
      className={cn(
        'card',
        hover && 'card-hover cursor-pointer',
        padding ? 'p-5' : 'p-0',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className, action }) {
  return (
    <div className={cn('flex items-center justify-between mb-4', className)}>
      <div className="flex items-center gap-2">{children}</div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardTitle({ children, className }) {
  return <h3 className={cn('font-semibold text-slate-100', className)}>{children}</h3>;
}

export function KPICard({ title, value, icon, change, changeLabel, trend, color = 'gold' }) {
  const colors = {
    gold: { icon: 'text-gold-400 bg-gold-500/10', trend: trend > 0 ? 'text-emerald-400' : 'text-red-400' },
    blue: { icon: 'text-blue-400 bg-blue-500/10', trend: trend > 0 ? 'text-emerald-400' : 'text-red-400' },
    green: { icon: 'text-emerald-400 bg-emerald-500/10', trend: trend > 0 ? 'text-emerald-400' : 'text-red-400' },
    purple: { icon: 'text-purple-400 bg-purple-500/10', trend: trend > 0 ? 'text-emerald-400' : 'text-red-400' },
  };

  const c = colors[color] || colors.gold;

  return (
    <div className="kpi-card">
      <div className="flex items-start justify-between">
        <div className={cn('p-2.5 rounded-xl', c.icon)}>
          {icon}
        </div>
        {change != null && (
          <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full bg-navy-700', c.trend)}>
            {trend > 0 ? '↑' : '↓'} {Math.abs(change)}%
          </span>
        )}
      </div>
      <div>
        <p className="text-2xl font-bold text-slate-100 mt-2">{value}</p>
        <p className="text-sm text-slate-400 mt-0.5">{title}</p>
        {changeLabel && <p className="text-xs text-slate-500 mt-1">{changeLabel}</p>}
      </div>
    </div>
  );
}
