import { cn } from '../../utils/cn';

export default function Skeleton({ className, ...props }) {
  return (
    <div
      className={cn('animate-pulse bg-navy-700/60 rounded-xl', className)}
      {...props}
    />
  );
}

export function SkeletonCard({ lines = 3 }) {
  return (
    <div className="card p-4 space-y-3">
      <Skeleton className="h-4 w-2/3" />
      {Array.from({ length: lines - 1 }).map((_, i) => (
        <Skeleton key={i} className={`h-3 ${i === lines - 2 ? 'w-1/2' : 'w-full'}`} />
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 4 }) {
  return (
    <div className="card overflow-hidden">
      <div className="p-4 border-b border-navy-700/60">
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="divide-y divide-navy-700/30">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex gap-4 px-4 py-3">
            {Array.from({ length: cols }).map((_, j) => (
              <Skeleton key={j} className="h-3 flex-1" style={{ opacity: 1 - j * 0.1 }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function SkeletonKPI() {
  return (
    <div className="kpi-card">
      <div className="flex items-start justify-between">
        <Skeleton className="w-10 h-10 rounded-xl" />
        <Skeleton className="w-16 h-5 rounded-full" />
      </div>
      <Skeleton className="h-7 w-24 mt-2" />
      <Skeleton className="h-3 w-32 mt-1" />
    </div>
  );
}
