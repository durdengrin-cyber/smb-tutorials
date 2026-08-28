import type { PaymentPort } from "./port";
import { razorpayPort } from "./razorpay";

export * from "./port";

function requireProvider(): string {
  const provider = process.env.PAYMENT_PROVIDER;
  if (!provider) {
    throw new Error("PAYMENT_PROVIDER is unset — configure a real provider");
  }
  return provider;
}

// The single place any caller obtains a port. Adding a real provider means
// adding one branch here and one adapter file — no caller changes.
export function getPaymentPort(): PaymentPort {
  const provider = requireProvider();

  if (provider === "razorpay") {
    // razorpayPort throws on any missing credential rather than deferring the
    // failure to the first charge. A missing webhook secret is the dangerous
    // one: checkout would work, the student would pay, and every webhook
    // would fail verification — money taken, nothing delivered.
    return razorpayPort(
      process.env.RAZORPAY_KEY_ID ?? "",
      process.env.RAZORPAY_KEY_SECRET ?? "",
      process.env.PAYMENT_WEBHOOK_SECRET ?? ""
    );
  }

  throw new Error(`Unknown PAYMENT_PROVIDER: ${provider}`);
}

export const paymentProviderName = () => requireProvider();
