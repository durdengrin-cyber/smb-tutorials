import Link from "next/link";
import { ForgotForm } from "./forgot-form";

export default async function ForgotPasswordPage({
  searchParams,
}: PageProps<"/forgot-password">) {
  const { error } = await searchParams;

  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-md flex-col justify-center px-6 py-16">
      <h1 className="mb-2 text-2xl font-black tracking-tight">Reset your password</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        We&rsquo;ll email you a link to set a new one.
      </p>
      <ForgotForm expired={error === "expired"} />
      <p className="mt-6 text-sm text-muted-foreground">
        <Link href="/signin" className="underline">Back to sign in</Link>
      </p>
    </div>
  );
}
