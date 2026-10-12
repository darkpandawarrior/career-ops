import { Skeleton } from "@/components/ui/skeleton";

export default function ApplyQueueLoading() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-8" aria-label="Loading apply queue">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="mt-3 h-4 w-full max-w-xl" />
      <div className="mt-6 space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}
