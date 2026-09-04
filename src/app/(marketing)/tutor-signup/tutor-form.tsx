"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signUpTutor } from "./actions";
import { SubjectPicker } from "./subject-picker";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const SELECT =
  "h-8 w-full rounded-lg border border-input bg-white px-2.5 py-1 text-sm font-medium text-gray-900 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function TutorForm() {
  const [state, formAction, isPending] = useActionState(signUpTutor, null);

  return (
    <form
      action={formAction}
      className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100 space-y-6"
    >
      {/* Personal Information */}
      <div>
        <h3 className="text-xl font-bold text-gray-900 mb-4">
          Personal Information
        </h3>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="tutor-fullName">Full Name *</Label>
            <Input
              id="tutor-fullName"
              type="text"
              name="fullName"
              required
              placeholder="Dr. John Doe"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tutor-email">Email Address *</Label>
            <Input
              id="tutor-email"
              type="email"
              name="email"
              required
              placeholder="your.email@example.com"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tutor-password">
              Password *{" "}
              <span className="font-normal text-gray-500">
                (you&apos;ll use this to sign in)
              </span>
            </Label>
            <Input
              id="tutor-password"
              type="password"
              name="password"
              required
              minLength={8}
              placeholder="At least 8 characters"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tutor-phone">Phone Number *</Label>
            <Input
              id="tutor-phone"
              type="tel"
              name="phone"
              required
              placeholder="10-digit number"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tutor-experience">Years of Experience *</Label>
            <Input
              id="tutor-experience"
              type="number"
              name="experience"
              required
              min={0}
              placeholder="e.g., 5"
            />
          </div>
        </div>
      </div>

      {/* Education & Qualifications */}
      <div>
        <h3 className="text-xl font-bold text-gray-900 mb-4">
          Education &amp; Qualifications
        </h3>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tutor-qualification">Highest Qualification *</Label>
            <Input
              id="tutor-qualification"
              type="text"
              name="qualification"
              required
              placeholder="e.g., PhD in Physics, IIT Delhi"
            />
          </div>

          <SubjectPicker />

          <div className="space-y-2">
            <Label htmlFor="tutor-specialization">Specialization</Label>
            <Input
              id="tutor-specialization"
              type="text"
              name="specialization"
              placeholder="e.g., Mechanics, Thermodynamics"
            />
          </div>
        </div>
      </div>

      {/* Teaching Preferences */}
      <div>
        <h3 className="text-xl font-bold text-gray-900 mb-4">
          Teaching Preferences
        </h3>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="tutor-teachingLevel">Preferred Teaching Level</Label>
            <select
              id="tutor-teachingLevel"
              name="teachingLevel"
              className={SELECT}
              defaultValue=""
            >
              <option value="">Select level</option>
              <option value="school">School (6th-12th)</option>
              <option value="college">College/University</option>
              <option value="both">Both</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tutor-hourlyRate">Hourly Rate (₹) *</Label>
            <Input
              id="tutor-hourlyRate"
              type="number"
              name="hourlyRate"
              required
              min={1}
              placeholder="e.g., 500"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tutor-hoursPerWeek">Hours Available per Week *</Label>
            <select
              id="tutor-hoursPerWeek"
              name="hoursPerWeek"
              required
              className={SELECT}
              defaultValue=""
            >
              <option value="">Select hours</option>
              <option value="5-10">5-10 hours/week</option>
              <option value="10-20">10-20 hours/week</option>
              <option value="20-30">20-30 hours/week</option>
              <option value="30-40">30-40 hours/week</option>
              <option value="40+">40+ hours/week (Full-time)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Demo Video */}
      <div>
        <h3 className="text-xl font-bold text-gray-900 mb-4">Demo Video</h3>
        <div className="space-y-3">
          <Label htmlFor="tutor-demoVideoUrl">
            Demo Video Link (YouTube or Google Drive) *
          </Label>
          <p className="text-sm text-gray-500 mb-3">
            Upload your 2-5 minute demo video to YouTube or Google Drive, then
            paste the link here. This helps students see your teaching style.
          </p>

          <Input
            id="tutor-demoVideoUrl"
            type="url"
            name="demoVideoUrl"
            required
            placeholder="https://www.youtube.com/watch?v=... or https://drive.google.com/file/d/..."
          />

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-blue-800 mb-2">
              <strong>📹 How to Upload Your Demo Video:</strong>
            </p>
            <div className="space-y-3">
              <div>
                <p className="text-sm font-semibold text-blue-900">
                  YouTube (Recommended):
                </p>
                <ol className="text-sm text-blue-700 mt-1 ml-4 space-y-1">
                  <li>1. Upload to YouTube (can be Unlisted)</li>
                  <li>2. Click Share → Copy link</li>
                  <li>3. Paste link above</li>
                </ol>
              </div>
              <div>
                <p className="text-sm font-semibold text-blue-900">
                  Google Drive:
                </p>
                <ol className="text-sm text-blue-700 mt-1 ml-4 space-y-1">
                  <li>1. Upload to Google Drive</li>
                  <li>2. Right-click → Share → Anyone with link</li>
                  <li>3. Copy link and paste above</li>
                </ol>
              </div>
            </div>
          </div>

          <div className="bg-teal-50 border border-teal-200 rounded-lg p-4">
            <p className="text-sm text-teal-800">
              <strong>💡 Demo Video Tips:</strong>
            </p>
            <ul className="text-sm text-teal-700 mt-2 space-y-1 ml-4">
              <li>• Good lighting and clear audio</li>
              <li>• Explain a concept step-by-step</li>
              <li>• Use whiteboard or screen sharing</li>
              <li>• Be enthusiastic and engaging</li>
              <li>• Keep it 2-5 minutes long</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Terms */}
      <div className="flex items-start">
        {/* name="consent" matters: without it this never reaches the server
            and `required` is browser-only decoration. Validated again in
            parseTutorSignUp, which is what makes its absence fail loudly. */}
        <input
          type="checkbox"
          name="consent"
          value="yes"
          required
          className="mt-1 mr-2"
        />
        <span className="text-sm text-gray-600">
          I agree to SMB Tutorials&apos;{" "}
          <Link
            href="/terms"
            className="text-teal-600 hover:text-teal-700 underline"
          >
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link
            href="/terms"
            className="text-teal-600 hover:text-teal-700 underline"
          >
            Tutor Agreement
          </Link>
          , and{" "}
          <Link
            href="/privacy"
            className="text-teal-600 hover:text-teal-700 underline"
          >
            Privacy Policy
          </Link>
        </span>
      </div>

      {state?.error && <FormError>{state.error}</FormError>}

      <Button type="submit" disabled={isPending} className="w-full h-12 font-bold">
        {isPending ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
                fill="none"
              ></circle>
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              ></path>
            </svg>
            Submitting Application...
          </span>
        ) : (
          "Submit Application"
        )}
      </Button>

      <p className="text-sm text-gray-500 text-center">
        Our team will review your application and contact you within 2-3
        business days.
      </p>
    </form>
  );
}
