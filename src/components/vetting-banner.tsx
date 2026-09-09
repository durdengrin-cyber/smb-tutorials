import { vettingMessage, type VettingState } from "@/lib/vetting";

export function VettingBanner({ state }: { state: VettingState }) {
  const message = vettingMessage(state);
  if (!message) return null;

  return (
    <div className="mx-auto mb-6 max-w-3xl rounded-md border border-border bg-card p-4">
      <p className="mb-1 font-semibold">{message.title}</p>
      <p className="text-sm text-muted-foreground">{message.body}</p>
    </div>
  );
}
