import { Skeleton } from "@/components/ui/skeleton";

/** Profile: cover band, avatar, then the field stack. The cover keeps its real
 *  height so the avatar doesn't jump once the image loads. */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-6">
      <Skeleton className="h-32 w-full rounded-xl sm:h-40" />
      <div className="-mt-10 pl-4">
        <Skeleton className="size-20 rounded-full border-4 border-background" />
      </div>
      <Skeleton className="mt-4 h-8 w-52" />
      <Skeleton className="mt-2 h-3 w-40" />

      <div className="mt-8 space-y-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i}>
            <Skeleton className="mb-2 h-3 w-24" />
            <Skeleton className="h-11 w-full rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}
