import Link from "next/link";
import { SignInForm } from "./signin-form";

export default async function SignInPage({
  searchParams,
}: PageProps<"/signin">) {
  const { error } = await searchParams;
  const initialError =
    error === "oauth" ? "Google sign-in failed — try again." : undefined;

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Left side - Image */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="https://images.unsplash.com/photo-1523240795612-9a054b0db644?w=1200&h=1200&fit=crop"
          alt="Students studying"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-teal-600/95 to-cyan-600/95"></div>

        <div className="relative z-10 flex flex-col justify-center p-16 text-white">
          <h1 className="text-5xl font-bold mb-6">Welcome Back!</h1>
          <p className="text-xl opacity-90 mb-8">
            Continue your learning journey with expert tutors
          </p>

          <div className="space-y-4">
            {[
              "Access your personalized dashboard",
              "Book sessions with your favorite tutors",
              "Track your learning progress",
            ].map((benefit) => (
              <div key={benefit} className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
                  <span className="text-2xl">✓</span>
                </div>
                <p className="text-lg">{benefit}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right side - Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6">
        <div className="max-w-md w-full">
          <div className="mb-6">
            <Link
              href="/"
              className="text-teal-600 hover:text-teal-700 font-medium inline-flex items-center gap-2"
            >
              ← Back to Home
            </Link>
          </div>

          <SignInForm initialError={initialError} />
        </div>
      </div>
    </div>
  );
}
