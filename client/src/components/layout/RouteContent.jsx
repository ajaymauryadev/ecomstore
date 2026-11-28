import { Suspense } from 'react';
import { useSelector } from 'react-redux';
import { selectSessionEpoch } from '../../features/auth/authSlice';
import Skeleton, { SkeletonTable } from '../ui/Skeleton';
import SavedReadBoundary from '../../offline/SavedReadBoundary';
import { SavedDataGate } from '../../offline/SavedDataStatus';

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
  // Keep the resolved boundary during route transitions. A pathname key forces
  // a fresh fallback even when the previous page and saved data are available.
  return <Suspense key={epoch} fallback={<RouteSkeleton />}>
    <SavedDataGate fallback={<RouteSkeleton label="Restoring saved view" />}>
      <SavedReadBoundary>{children}</SavedReadBoundary>
    </SavedDataGate>
  </Suspense>;
}
