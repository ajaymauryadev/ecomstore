import { NavLink } from 'react-router-dom';
import { cn } from '../../utils/cn';

const itemClass = (active) => cn(
  'flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-lg px-1 text-center text-[11px] font-semibold leading-tight',
  'transition-colors focus-visible:outline-offset-[-3px] hover:bg-[var(--brand-tint)]',
  active ? 'bg-[var(--brand-tint)] text-gold-400' : 'text-slate-500'
);

export default function MobileNavigation({ label, items, className }) {
  return (
    <nav aria-label={label} className={cn("safe-bottom shrink-0 border-t border-[var(--brand-line)] bg-navy-900", className)}>
      <div className="mx-auto flex max-w-2xl items-stretch px-1">
        {items.map(({ label: name, icon: Icon, to, end, onClick, expanded, active, count, ariaLabel, disabled }) => {
          const content = (
            <>
              <span className="relative">
                <Icon size={20} aria-hidden="true" />
                {count > 0 && (
                  <span aria-hidden="true" className="absolute -right-3 -top-1.5 min-w-4 rounded-full bg-gold-500 px-1 text-[9px] font-bold leading-4 text-white">
                    {count > 99 ? '99+' : count}
                  </span>
                )}
              </span>
              <span>{name}</span>
            </>
          );

          return to ? (
            <NavLink key={name} to={to} end={end} className={({ isActive }) => itemClass(isActive)}>
              {content}
            </NavLink>
          ) : (
            <button key={name} type="button" onClick={onClick} disabled={disabled} aria-label={ariaLabel} aria-expanded={expanded} className={itemClass(active)}>
              {content}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
