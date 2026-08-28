"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  CURRICULA,
  GRADES,
  STREAMS,
  SUBJECTS_BY_STREAM,
  type Stream,
} from "@/lib/taxonomy";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";

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

      <div className="relative z-10 flex items-center justify-center px-8 py-12">
        <div className="max-w-2xl w-full">
          <PageHeader
            title="Tell Us What You Need"
            description="We'll find the perfect teacher for you"
          />

          <Card>
            <CardContent className="p-8">
            {/* Curriculum */}
            <div className="mb-6">
              <label className="block text-sm font-semibold text-gray-700 mb-3">
                Curriculum
              </label>
              <div className="grid grid-cols-3 gap-3">
                {CURRICULA.map((c) => (
                  <Button
                    key={c}
                    type="button"
                    variant={curriculum === c ? "default" : "outline"}
                    className="h-auto py-3"
                    onClick={() => setCurriculum(c)}
                  >
                    {c}
                  </Button>
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
                    <Button
                      key={s}
                      type="button"
                      variant={stream === s ? "default" : "outline"}
                      className="h-auto py-3"
                      onClick={() => {
                        setStream(s);
                        setSubject("");
                      }}
                    >
                      {s}
                    </Button>
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
              <Button
                type="button"
                size="lg"
                className="h-auto w-full py-4 animate-fadeIn"
                onClick={findTeachers}
              >
                Find Available Teachers →
              </Button>
            )}
            </CardContent>
          </Card>

          {/* Custom subject request — the request tier arrives in M4 */}
          {grade && !subject && (
            <div className="mt-12 animate-fadeIn">
              <Card>
                <CardContent className="p-8 text-center">
                  <h3 className="text-xl font-bold text-gray-900 mb-3">
                    Looking for a different {stream ? "subject" : "field"}?
                  </h3>
                  <p className="text-gray-600 mb-6">
                    Can&apos;t find your {stream ? "subject" : "field"} in our
                    list? Let us know what you&apos;re looking for and we&apos;ll
                    help you find the right teacher.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    disabled
                    title="Custom requests arrive with the request tier (M4)"
                  >
                    Request a Custom Subject
                  </Button>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
