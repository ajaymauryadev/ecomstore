import { cn } from '../../utils/cn';

export default function EmptyState({ icon: Icon, title, description, action, className }) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 px-4 text-center', className)}>
      {Icon && (
        <div className="w-16 h-16 rounded-2xl bg-navy-700/60 flex items-center justify-center mb-4">
          <Icon size={28} className="text-slate-500" />
        </div>
      )}
      <h3 className="font-semibold text-slate-300 text-base mb-1">{title}</h3>
      {description && <p className="text-sm text-slate-500 max-w-xs">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
