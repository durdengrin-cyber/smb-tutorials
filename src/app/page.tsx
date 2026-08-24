export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gradient-to-br from-teal-50 to-cyan-50 px-6 text-center">
      <h1 className="text-4xl font-bold text-gray-900">SMB Tutorials</h1>
      <p className="text-lg font-medium text-teal-600">One Student, One Teacher.</p>
      <p className="max-w-md text-gray-600">
        Instant, on-demand 1:1 tutoring over video — coming soon.
      </p>
      <a
        href="/call"
        className="rounded-lg bg-gradient-to-r from-teal-500 to-cyan-600 px-6 py-3 font-semibold text-white transition-all hover:from-teal-600 hover:to-cyan-700"
      >
        Try the call spike
      </a>
    </main>
  );
}
