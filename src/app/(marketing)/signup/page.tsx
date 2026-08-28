import Link from "next/link";
import { SignUpForm } from "./signup-form";

const BENEFITS = [
  { icon: "🎯", text: "Learn any subject from qualified experts" },
  { icon: "⚡", text: "See who's online now and start right away" },
  { icon: "💪", text: "Achieve your learning goals faster" },
];

export default function SignUpPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Left side - Image */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=1200&h=1200&fit=crop"
          alt="Happy students learning"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-600/95 to-teal-600/95"></div>

        <div className="relative z-10 flex flex-col justify-center p-16 text-white">
          <h2 className="text-5xl font-bold mb-6">Start Learning Today!</h2>
          <p className="text-xl opacity-90 mb-8">
            Connect with expert tutors and start learning right away
          </p>

          <div className="space-y-4">
            {BENEFITS.map(({ icon, text }) => (
              <div key={text} className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
                  <span className="text-2xl">{icon}</span>
                </div>
                <p className="text-lg">{text}</p>
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
              href="/signin"
              className="text-teal-600 hover:text-teal-700 font-medium inline-flex items-center gap-2"
            >
              ← Back to Sign In
            </Link>
          </div>

          <SignUpForm />
        </div>
      </div>
    </div>
  );
}
