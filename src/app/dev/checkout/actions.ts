"use server";

import { redirect } from "next/navigation";
import { getPaymentPort } from "@/lib/payments";

// Stands in for a provider's hosted checkout: signs a success event exactly as
// a provider would and posts it to our own webhook. Refuses in production for
// the same reason the stub port does — this can mint a paid session.
export async function payNow(formData: FormData) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("the development checkout is refused in production");
  }
  const port = getPaymentPort();
  if (!port.signForTest) throw new Error("dev checkout requires the stub port");

  const body = JSON.stringify({
    sessionId: String(formData.get("session")),
    amountPaise: Number(formData.get("amount")),
    paymentRef: String(formData.get("ref")),
    kind: "succeeded",
  });

  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const res = await fetch(`${base}/api/payments/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-payment-signature": port.signForTest(body),
    },
    body,
  });
  if (!res.ok) console.error("[dev checkout] webhook rejected:", res.status);

  redirect(String(formData.get("success")));
}
