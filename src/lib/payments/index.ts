import type { PaymentPort } from "./port";
import { stubPort } from "./stub";

export * from "./port";

// The single place any caller obtains a port. Adding a real provider means
// adding one branch here and one adapter file — no caller changes.
export function getPaymentPort(): PaymentPort {
  const provider = process.env.PAYMENT_PROVIDER ?? "stub";

  if (provider === "stub") {
    // A stub that could run in production is free tutoring for anyone who
    // finds the webhook. Refuse loudly rather than degrade quietly.
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "PAYMENT_PROVIDER=stub is refused in production — configure a real provider"
      );
    }
    return stubPort(process.env.PAYMENT_WEBHOOK_SECRET ?? "");
  }

  throw new Error(`Unknown PAYMENT_PROVIDER: ${provider}`);
}

export const paymentProviderName = () => process.env.PAYMENT_PROVIDER ?? "stub";
