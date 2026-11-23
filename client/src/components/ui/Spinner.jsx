import { cn } from '../../utils/cn';

const sizes = {
  xs: 'w-3 h-3 border',
  sm: 'w-4 h-4 border-2',
  md: 'w-6 h-6 border-2',
  lg: 'w-8 h-8 border-[3px]',
  xl: 'w-12 h-12 border-4',
};

export default function Spinner({ size = 'md', className }) {
  return (
    <span
      className={cn(
        'inline-block rounded-full border-current border-r-transparent animate-spin',
        sizes[size],
        className
      )}
      role="status"
      aria-label="Loading"
    />
  );
}

export function PageLoader({ className }) {
  return (
    <div className={cn('min-h-screen bg-navy-950 flex flex-col items-center justify-center gap-4', className)}>
      <div className="relative">
        <div className="w-16 h-16 rounded-full border-4 border-navy-700" />
        <div className="absolute inset-0 w-16 h-16 rounded-full border-4 border-gold-500 border-r-transparent animate-spin" />
      </div>
      <p className="text-slate-400 text-sm animate-pulse-gold">Loading Smart Kirana...</p>
    </div>
  );
}
