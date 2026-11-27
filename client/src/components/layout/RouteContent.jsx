import { Suspense } from 'react';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';
import { selectSessionEpoch } from '../../features/auth/authSlice';
import Skeleton, { SkeletonTable } from '../ui/Skeleton';
import SavedReadBoundary from '../../offline/SavedReadBoundary';

export function RouteSkeleton({ label = 'Loading page' }) {
  return (
    <div role="status" aria-label={label} className="space-y-5">
      <div aria-hidden="true" className="space-y-4">
        <Skeleton className="h-8 w-52 max-w-full" />
        <Skeleton className="h-4 w-72 max-w-full" />
        <SkeletonTable />
      </div>
    </div>
  );
}

export default function RouteContent({ children }) {
  const epoch = useSelector(selectSessionEpoch);
  const { pathname } = useLocation();
  return <Suspense key={`${epoch}:${pathname}`} fallback={<RouteSkeleton />}><SavedReadBoundary>{children}</SavedReadBoundary></Suspense>;
}
