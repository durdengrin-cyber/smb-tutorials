"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signUpTutor } from "./actions";
import { SubjectPicker } from "./subject-picker";

const FIELD =
  "w-full py-3 px-4 rounded-lg border-2 border-gray-200 focus:border-teal-600 focus:outline-none";
const SELECT = `${FIELD} text-gray-900 font-medium text-base bg-white`;
const LABEL = "block text-sm font-semibold text-gray-700 mb-2";

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
          <div>
            <label className={LABEL}>Full Name *</label>
            <input
              type="text"
              name="fullName"
              required
              placeholder="Dr. John Doe"
              className={FIELD}
            />
          </div>
          <div>
            <label className={LABEL}>Email Address *</label>
            <input
              type="email"
              name="email"
              required
              placeholder="your.email@example.com"
              className={FIELD}
            />
          </div>
          <div>
            <label className={LABEL}>
              Password *{" "}
              <span className="font-normal text-gray-500">
                (you&apos;ll use this to sign in)
              </span>
            </label>
            <input
              type="password"
              name="password"
              required
              minLength={8}
              placeholder="At least 8 characters"
              className={FIELD}
            />
          </div>
          <div>
            <label className={LABEL}>Phone Number *</label>
            <input
              type="tel"
              name="phone"
              required
              placeholder="10-digit number"
              className={FIELD}
            />
          </div>
          <div>
            <label className={LABEL}>Years of Experience *</label>
            <input
              type="number"
              name="experience"
              required
              min={0}
              placeholder="e.g., 5"
              className={FIELD}
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
          <div>
            <label className={LABEL}>Highest Qualification *</label>
            <input
              type="text"
              name="qualification"
              required
              placeholder="e.g., PhD in Physics, IIT Delhi"
              className={FIELD}
            />
          </div>

          <SubjectPicker />

          <div>
            <label className={LABEL}>Specialization</label>
            <input
              type="text"
              name="specialization"
              placeholder="e.g., Mechanics, Thermodynamics"
              className={FIELD}
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
          <div>
            <label className={LABEL}>Preferred Teaching Level</label>
            <select name="teachingLevel" className={SELECT} defaultValue="">
              <option value="">Select level</option>
              <option value="school">School (6th-12th)</option>
              <option value="college">College/University</option>
              <option value="both">Both</option>
            </select>
          </div>
          <div>
            <label className={LABEL}>Hourly Rate (₹) *</label>
            <input
              type="number"
              name="hourlyRate"
              required
              min={1}
              placeholder="e.g., 500"
              className={FIELD}
            />
          </div>
          <div>
            <label className={LABEL}>Hours Available per Week *</label>
            <select
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
          <label className="block text-sm font-semibold text-gray-700">
            Demo Video Link (YouTube or Google Drive) *
          </label>
          <p className="text-sm text-gray-500 mb-3">
            Upload your 2-5 minute demo video to YouTube or Google Drive, then
            paste the link here. This helps students see your teaching style.
          </p>

          <input
            type="url"
            name="demoVideoUrl"
            required
            placeholder="https://www.youtube.com/watch?v=... or https://drive.google.com/file/d/..."
            className={FIELD}
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
        <input type="checkbox" required className="mt-1 mr-2" />
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
        </span>
      </div>

      {state?.error && <p className="text-red-600 text-sm">{state.error}</p>}

      <button
        type="submit"
        disabled={isPending}
        className="w-full bg-gradient-to-r from-teal-500 to-cyan-600 hover:from-teal-600 hover:to-cyan-700 text-white font-bold py-4 rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
      >
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
      </button>

      <p className="text-sm text-gray-500 text-center">
        Our team will review your application and contact you within 2-3
        business days.
      </p>
    </form>
  );
}
