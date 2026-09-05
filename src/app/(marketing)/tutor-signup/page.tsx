import { GoogleButton } from "@/components/google-button";
import { PageHeader } from "@/components/page-header";
import { TutorForm } from "./tutor-form";

export default function TutorSignUpPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 via-cyan-50 to-blue-50">
      <main className="px-8 py-12">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-12">
            <div className="text-6xl mb-4">‍</div>
            <PageHeader
              title="Join as a Tutor"
              description="Start teaching and making a difference today"
            />
          </div>

          <div className="max-w-md mx-auto mb-8">
            <GoogleButton label="Sign up with Google" next="/tutor-signup" />
          </div>

          <TutorForm />
        </div>
      </main>
    </div>
  );
}
