import { notFound } from "next/navigation";
import { payNow } from "./actions";

export default async function DevCheckoutPage({
  searchParams,
}: PageProps<"/dev/checkout">) {
  if (process.env.NODE_ENV === "production") notFound();
  const p = await searchParams;
  const one = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v[0] ?? "" : v ?? "";

  const amount = Number(one(p.amount));

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-8">
      <div className="bg-white rounded-2xl border border-gray-200 p-10 max-w-md w-full text-center">
        <p className="text-xs font-semibold tracking-wide text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-1 inline-block mb-6">
          DEVELOPMENT CHECKOUT — NOT A REAL PAYMENT
        </p>
        <p className="text-3xl font-bold text-gray-900 mb-1">
          ₹{Math.round(amount / 100)}
        </p>
        <p className="text-gray-600 mb-8">SMB Tutorials session</p>
        <form action={payNow} className="flex gap-3 justify-center">
          {(["session", "amount", "ref", "success", "cancel"] as const).map((k) => (
            <input key={k} type="hidden" name={k} value={one(p[k])} />
          ))}
          <button
            type="submit"
            className="bg-gradient-to-r from-teal-500 to-cyan-600 text-white font-semibold px-8 py-3 rounded-lg"
          >
            Pay now
          </button>
          <a
            href={one(p.cancel)}
            className="bg-white border-2 border-gray-300 text-gray-700 font-semibold px-8 py-3 rounded-lg"
          >
            Cancel
          </a>
        </form>
      </div>
    </main>
  );
}
