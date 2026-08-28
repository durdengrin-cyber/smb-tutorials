import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Skeleton className="h-[80vh] w-full max-w-5xl rounded-xl" />
    </div>
  );
}
