import Link from "next/link";

const FEATURES = [
  {
    icon: "📚",
    title: "Any Subject",
    body: "From math to music, find teachers for every topic you want to learn.",
  },
  {
    icon: "⚡",
    title: "Start right now",
    body: "See which teachers are online this minute and start a one-to-one lesson immediately.",
  },
  {
    icon: "👨‍🏫",
    title: "Expert Teachers",
    body: "Learn from qualified educators who specialize in your topic.",
  },
];

const TUTOR_BENEFITS = [
  {
    icon: "👥",
    title: "Find new students",
    body: "Get matched with students looking for your expertise",
  },
  {
    icon: "💼",
    title: "Grow your business",
    body: "Set your own rates and schedule. Work from anywhere",
  },
  {
    icon: "💰",
    title: "Get paid securely",
    body: "Receive payments safely and on time, every time",
  },
];

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white relative overflow-hidden">
      {/* Background Pattern */}
      <div className="absolute inset-0 opacity-5">
        <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern
              id="grid"
              width="40"
              height="40"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 40 0 L 0 0 0 40"
                fill="none"
                stroke="#14B8A6"
                strokeWidth="1"
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
      </div>

      {/* Decorative Background Elements */}
      <div className="absolute top-20 right-10 w-72 h-72 bg-teal-100 rounded-full blur-3xl opacity-30"></div>
      <div className="absolute bottom-20 left-10 w-96 h-96 bg-cyan-100 rounded-full blur-3xl opacity-30"></div>

      <main className="relative z-10 flex items-center justify-center px-8">
        <div className="max-w-4xl w-full">
          {/* Hero */}
          <div className="grid md:grid-cols-2 gap-12 items-center mb-20 mt-8">
            <div>
              <div className="inline-block bg-teal-100 text-teal-700 px-4 py-2 rounded-full text-sm font-semibold mb-6">
                🎓 Your Personal Learning Platform
              </div>

              <h2 className="text-6xl font-bold text-gray-900 mb-6 leading-tight">
                Learn Anything,
                <br />
                <span className="bg-gradient-to-r from-teal-600 to-cyan-600 bg-clip-text text-transparent">
                  Anytime
                </span>
              </h2>

              <p className="text-xl text-gray-600 mb-8">
                Connect with expert teachers for hourly sessions. See who&apos;s
                online right now and start learning immediately.
              </p>

              <div className="flex flex-col sm:flex-row gap-4 mb-8">
                <Link
                  href="/find"
                  className="bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-700 hover:to-cyan-700 text-white font-bold px-8 py-4 rounded-xl text-lg transition-all duration-200 shadow-lg hover:shadow-xl text-center"
                >
                  Find a Teacher →
                </Link>
                <Link
                  href="/teachers"
                  className="bg-white border-2 border-teal-600 text-teal-600 hover:bg-teal-50 font-semibold px-8 py-4 rounded-xl text-lg transition-all duration-200 text-center"
                >
                  Browse Teachers
                </Link>
              </div>

              <div className="grid grid-cols-3 gap-4 pt-6 border-t border-gray-200">
                <div className="text-center">
                  <div className="text-3xl mb-2">📚</div>
                  <p className="text-sm font-semibold text-gray-900">
                    All Subjects
                  </p>
                  <p className="text-xs text-gray-600">Any topic</p>
                </div>
                <div className="text-center">
                  <div className="text-3xl mb-2">⚡</div>
                  <p className="text-sm font-semibold text-gray-900">Instant</p>
                  <p className="text-xs text-gray-600">Start right now</p>
                </div>
                <div className="text-center">
                  <div className="text-3xl mb-2">💯</div>
                  <p className="text-sm font-semibold text-gray-900">Quality</p>
                  <p className="text-xs text-gray-600">Expert tutors</p>
                </div>
              </div>
            </div>

            {/* Image collage */}
            <div className="relative">
              <div className="relative z-10 rounded-3xl overflow-hidden shadow-2xl">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=600&h=600&fit=crop"
                  alt="Students learning together"
                  className="w-full h-auto"
                />
                <div className="absolute bottom-6 left-6 right-6 bg-white rounded-2xl p-4 shadow-xl">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center text-white text-2xl">
                      ✓
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-gray-900">
                        One-on-One Sessions
                      </p>
                      <p className="text-sm text-gray-600">
                        Personalized attention, real results
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="absolute -top-6 -right-6 w-32 h-32 bg-gradient-to-br from-teal-400 to-cyan-500 rounded-3xl opacity-20 -z-10"></div>
              <div className="absolute -bottom-6 -left-6 w-40 h-40 bg-gradient-to-br from-cyan-400 to-teal-500 rounded-3xl opacity-20 -z-10"></div>
            </div>
          </div>

          {/* Features */}
          <div className="grid md:grid-cols-3 gap-8 mt-20">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 hover:shadow-lg transition-all duration-200"
              >
                <div className="w-16 h-16 bg-gradient-to-br from-teal-500 to-cyan-600 rounded-2xl flex items-center justify-center mb-6 shadow-md">
                  <span className="text-3xl">{f.icon}</span>
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-3">
                  {f.title}
                </h3>
                <p className="text-gray-600">{f.body}</p>
              </div>
            ))}
          </div>

          {/* Become a tutor */}
          <div className="mt-32 mb-16">
            <div className="bg-white rounded-3xl shadow-xl border border-gray-100 overflow-hidden">
              <div className="grid md:grid-cols-2 gap-0">
                <div className="relative overflow-hidden h-96 md:h-auto">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=800&h=800&fit=crop"
                    alt="Tutor teaching students"
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-br from-teal-600/90 to-cyan-600/90"></div>

                  <div className="relative z-10 h-full flex flex-col items-center justify-center p-12 text-white">
                    <div className="text-center space-y-6">
                      <div className="text-7xl mb-6">👨‍🏫</div>

                      <div className="bg-white/20 backdrop-blur-md rounded-2xl px-8 py-4 inline-block border border-white/30">
                        <p className="text-2xl font-bold">
                          Share Your Knowledge
                        </p>
                      </div>

                      <p className="text-lg opacity-90 max-w-sm mx-auto">
                        Turn your expertise into income by teaching students
                        worldwide
                      </p>

                      <div className="flex gap-2 justify-center mt-6">
                        {["📚", "💡", "🎓"].map((e) => (
                          <div
                            key={e}
                            className="w-12 h-12 rounded-full bg-white/30 backdrop-blur-sm flex items-center justify-center border border-white/40"
                          >
                            <span className="text-2xl">{e}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-12">
                  <div className="inline-block bg-teal-100 text-teal-700 px-3 py-1 rounded-full text-sm font-semibold mb-4">
                    🚀 Now Hiring
                  </div>

                  <h2 className="text-4xl font-bold text-gray-900 mb-4">
                    Become a tutor
                  </h2>
                  <p className="text-lg text-gray-600 mb-8">
                    Earn money sharing your expert knowledge with students. Sign
                    up to start tutoring online with SMB Tutorials.
                  </p>

                  <div className="space-y-4 mb-8">
                    {TUTOR_BENEFITS.map((b) => (
                      <div key={b.title} className="flex items-start gap-3">
                        <div className="w-10 h-10 bg-gradient-to-br from-teal-500 to-cyan-600 rounded-xl flex items-center justify-center flex-shrink-0 shadow-md">
                          <span className="text-white text-lg">{b.icon}</span>
                        </div>
                        <div>
                          <h3 className="font-semibold text-gray-900">
                            {b.title}
                          </h3>
                          <p className="text-gray-600 text-sm">{b.body}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  <Link
                    href="/tutor-signup"
                    className="inline-block bg-gradient-to-r from-teal-500 to-cyan-600 hover:from-teal-600 hover:to-cyan-700 text-white font-bold px-8 py-4 rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl"
                  >
                    Become a tutor →
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
