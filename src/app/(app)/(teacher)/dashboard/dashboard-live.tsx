"use client";

import { useState } from "react";
import { AvailabilityToggle } from "./availability-toggle";
import { IncomingRequest } from "./incoming-request";

// Presence and the request card have to agree on one fact — whether this
// teacher is currently committed to a student — and they are siblings, so the
// state that joins them lives here rather than in either of them.
//
// Why it is needed at all: M3 spec §9's regression. Both the parent spec and
// the M2 design require a busy teacher to be HIDDEN from the online list, and
// that used to happen for free, because accepting navigated straight into the
// call and unmounted the dashboard. M3 put a 120-second payment window in
// front of the call, during which the dashboard stays mounted — so the
// teacher went on advertising themselves to students whose requests could
// only ever be refused. The card knows when the commitment starts and ends;
// the toggle owns the presence channel; this joins them.
//
// A fragment, not a wrapper element: the dashboard's `space-y-8` spacing is
// applied to direct children, and a div here would collapse it.
export function DashboardLive({
  teacherId,
  fullName,
  hourlyRate,
  declaredUntil,
  hasDevice,
  suspended = false,
}: {
  teacherId: string;
  fullName: string;
  hourlyRate: number;
  // Server-read declaration and device count, from page.tsx. Threaded
  // straight through: this component holds the inSession fact the two
  // siblings share, not the availability facts, which only the toggle needs.
  declaredUntil: string | null;
  hasDevice: boolean;
  // Server-read from my_suspension() in page.tsx. Threaded straight through
  // to the toggle, which is the only sibling that needs it.
  suspended?: boolean;
}) {
  const [inSession, setInSession] = useState(false);

  return (
    <>
      <IncomingRequest teacherId={teacherId} onLiveSessionChange={setInSession} />
      <AvailabilityToggle
        teacherId={teacherId}
        fullName={fullName}
        hourlyRate={hourlyRate}
        inSession={inSession}
        declaredUntil={declaredUntil}
        hasDevice={hasDevice}
        suspended={suspended}
      />
    </>
  );
}
