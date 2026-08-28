import { cn } from "@/lib/utils";

// A single accessible form-error rendering: role="alert" so a screen-reader
// user is told when something failed, plus the destructive token rather than
// a raw color. Used on every form surface that can show a submission error,
// marketing and app alike — the app ones sit inside the payment window.
export function FormError({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p role="alert" className={cn("text-sm text-destructive", className)}>
      {children}
    </p>
  );
}
