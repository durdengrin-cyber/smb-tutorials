import { TutorForm } from "./tutor-form";

export default function TutorSignUpPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 via-cyan-50 to-blue-50">
      <main className="px-8 py-12">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-12">
            <div className="text-6xl mb-4">👨‍🏫</div>
            <h2 className="text-4xl font-bold text-gray-900 mb-4">
              Join as a Tutor
            </h2>
            <p className="text-lg text-gray-600">
              Start teaching and making a difference today
            </p>
          </div>

          <TutorForm />
        </div>
      </main>
    </div>
  );
}
