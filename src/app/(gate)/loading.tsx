import { Skeleton } from "@/components/ui/skeleton";

// Mirrors the card (gate)/consent/page.tsx renders — one panel, not the app
// shell's stack of them — so the screen does not reflow when the real
// content arrives.
export default function Loading() {
  return (
    <div className="px-4 py-10 sm:px-8 sm:py-12">
      <div className="mx-auto max-w-lg space-y-4">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    </div>
  );
}
