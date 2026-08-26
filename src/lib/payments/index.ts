import type { PaymentPort } from "./port";
import { stubPort, type StubPaymentPort } from "./stub";

export * from "./port";
export type { StubPaymentPort } from "./stub";

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

// The only way to reach signForTest. Kept separate from getPaymentPort so
// that ordinary callers (checkout creation, webhook verification, refunds)
// can never receive a signing capability by accident — only code that
// explicitly asks for the stub gets it, and stubPort's own guard still
// refuses in production even if this function is called there.
export function getStubPort(): StubPaymentPort {
  return stubPort(process.env.PAYMENT_WEBHOOK_SECRET ?? "");
}

export const paymentProviderName = () => process.env.PAYMENT_PROVIDER ?? "stub";
