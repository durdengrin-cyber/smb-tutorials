"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SiteHeader } from "@/components/site-header";
import {
  CURRICULA,
  GRADES,
  STREAMS,
  SUBJECTS_BY_STREAM,
  type Stream,
} from "@/lib/taxonomy";

export default function FindPage() {
  const router = useRouter();
  const [curriculum, setCurriculum] = useState("");
  const [grade, setGrade] = useState("");
  const [stream, setStream] = useState<Stream | "">("");
  const [subject, setSubject] = useState("");

  function findTeachers() {
    const params = new URLSearchParams({ curriculum, grade, stream, subject });
    router.push(`/teachers?${params}`);
  }

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

      <div className="relative z-10">
        <SiteHeader />
      </div>

      <main
        className="relative z-10 flex items-center justify-center px-8 py-12"
        style={{ minHeight: "calc(100vh - 120px)" }}
      >
        <div className="max-w-2xl w-full">
          <div className="text-center mb-12">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">
              Tell Us What You Need
            </h2>
            <p className="text-gray-600">
              We&apos;ll find the perfect teacher for you
            </p>
          </div>

          <div className="bg-white p-8 rounded-2xl shadow-lg border border-gray-100">
            {/* Curriculum */}
            <div className="mb-6">
              <label className="block text-sm font-semibold text-gray-700 mb-3">
                Curriculum
              </label>
              <div className="grid grid-cols-3 gap-3">
                {CURRICULA.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCurriculum(c)}
                    className={`py-3 px-4 rounded-lg border-2 font-medium transition-all ${
                      curriculum === c
                        ? "border-teal-600 bg-teal-50 text-teal-600"
                        : "border-gray-200 hover:border-teal-300 text-gray-700"
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            {/* Grade */}
            {curriculum && (
              <div className="mb-6 animate-fadeIn">
                <label className="block text-sm font-semibold text-gray-700 mb-3">
                  Class / Grade
                </label>
                <select
                  value={grade}
                  onChange={(e) => setGrade(e.target.value)}
                  className="w-full py-3 px-4 rounded-lg border-2 border-gray-200 focus:border-teal-600 focus:outline-none text-gray-900 font-medium text-base bg-white"
                >
                  <option value="">Select your grade</option>
                  {GRADES.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Core Field (stream) */}
            {grade && (
              <div className="mb-6 animate-fadeIn">
                <label className="block text-sm font-semibold text-gray-700 mb-3">
                  Core Field
                </label>
                <div className="grid grid-cols-3 gap-3">
                  {STREAMS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setStream(s);
                        setSubject("");
                      }}
                      className={`py-3 px-4 rounded-lg border-2 font-medium transition-all ${
                        stream === s
                          ? "border-teal-600 bg-teal-50 text-teal-600"
                          : "border-gray-200 hover:border-teal-300 text-gray-700"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Subject */}
            {stream && (
              <div className="mb-6 animate-fadeIn">
                <label className="block text-sm font-semibold text-gray-700 mb-3">
                  Subject
                </label>
                <select
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full py-3 px-4 rounded-lg border-2 border-gray-200 focus:border-teal-600 focus:outline-none text-gray-900 font-medium text-base bg-white"
                >
                  <option value="">Select subject</option>
                  {SUBJECTS_BY_STREAM[stream].map((sub) => (
                    <option key={sub} value={sub}>
                      {sub}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Submit */}
            {subject && (
              <button
                type="button"
                onClick={findTeachers}
                className="w-full bg-gradient-to-r from-teal-500 to-cyan-600 hover:from-teal-600 hover:to-cyan-700 text-white font-semibold py-4 rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl animate-fadeIn"
              >
                Find Available Teachers →
              </button>
            )}
          </div>

          {/* Custom subject request — the request tier arrives in M4 */}
          {grade && !subject && (
            <div className="mt-12 text-center animate-fadeIn">
              <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-2xl p-8 border border-gray-200">
                <h3 className="text-xl font-bold text-gray-900 mb-3">
                  Looking for a different {stream ? "subject" : "field"}?
                </h3>
                <p className="text-gray-600 mb-6">
                  Can&apos;t find your {stream ? "subject" : "field"} in our
                  list? Let us know what you&apos;re looking for and we&apos;ll
                  help you find the right teacher.
                </p>
                <button
                  type="button"
                  disabled
                  title="Custom requests arrive with the request tier (M4)"
                  className="bg-white border-2 border-teal-600 text-teal-600 font-semibold px-8 py-3 rounded-lg opacity-50 cursor-not-allowed"
                >
                  Request a Custom Subject
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
