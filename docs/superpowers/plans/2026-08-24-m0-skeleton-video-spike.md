# M0 — Deploy Skeleton + Video Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Next.js app on the existing GitHub→Vercel repo and get two browsers into a live peer-to-peer video call via Daily.co.

**Architecture:** A Next.js (App Router) app deployed on Vercel with GitHub auto-deploy. A serverless API route (`/api/rooms`) mints/looks up a Daily.co room using a server-only API key. A client page (`/call`) embeds Daily's prebuilt video iframe and joins the room; a shareable invite link lets a second browser join the same room. No always-on server.

**Tech Stack:** Next.js (App Router, TypeScript), Tailwind CSS, `@daily-co/daily-js` (prebuilt video), Vitest (unit tests), Daily.co REST API, Vercel.

## Global Constraints

- **Runtime:** Node.js >= 18.18 (required by Next.js 15).
- **Deploy:** GitHub → Vercel auto-deploy. `main` = production; PRs = preview. Sync (`git fetch origin main` + rebase) before every push.
- **Serverless only:** no always-on server/VPS. Any backend logic lives in Next.js API routes / Server Actions.
- **Secrets:** `DAILY_API_KEY` is server-only. It lives in `.env.local` (gitignored) locally and in Vercel project env vars in production. Never commit it, never expose it to the client (no `NEXT_PUBLIC_` prefix).
- **Repo already exists:** `~/smb-tutorials` is a git repo with `origin` on GitHub (`durdengrin-cyber/smb-tutorials`), branch `main`, and per-repo credential isolation (`credential.useHttpPath true`). Do not re-init git or change the remote.
- **Preserve existing files:** `CLAUDE.md`, `project_state.md`, and `docs/` already exist and must survive scaffolding.

---

## Prerequisites (manual, one-time — user action)

These are not code steps; they unblock Task 2/3 verification. Do them before Task 2.

- [ ] **P1. Create a Daily.co account** at https://dashboard.daily.co/ (free tier).
- [ ] **P2. Copy the API key** from Daily dashboard → **Developers** → API key.
- [ ] **P3. Save it locally** — after Task 1 creates the project, create `~/smb-tutorials/.env.local` containing:
  ```
  DAILY_API_KEY=<paste-key-here>
  ```
  (`.env*` is gitignored by Next.js's default `.gitignore`, so this is never committed.)
- [ ] **P4. Add it to Vercel** — after Task 1's Vercel import: Vercel project → **Settings → Environment Variables** → add `DAILY_API_KEY` for Production + Preview + Development. Redeploy after adding.

---

## Task 1: Scaffold Next.js app + wire the deploy loop

**Files:**
- Preserve then restore: `CLAUDE.md`, `project_state.md` (moved aside during scaffold — `create-next-app` refuses to run in a folder containing non-allowlisted files; `docs/` and `.gitignore` are on its allowlist and stay put).
- Create (generated): `package.json`, `next.config.ts`, `tsconfig.json`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, and Tailwind config.
- Modify: `src/app/page.tsx` (replace boilerplate with placeholder).

**Interfaces:**
- Consumes: nothing (first task).
- Produces: a working Next.js app at repo root with `npm run dev` on port 3000, deployed live on Vercel. Later tasks add `src/app/api/…` and `src/app/call/…` routes and depend on `@/*` import alias resolving to `src/`.

- [ ] **Step 1: Move non-allowlisted files aside**

```bash
cd ~/smb-tutorials
mkdir -p /tmp/smb-preserve
mv CLAUDE.md project_state.md /tmp/smb-preserve/
```

- [ ] **Step 2: Scaffold the app in place**

```bash
cd ~/smb-tutorials
npx create-next-app@latest . --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --no-turbopack
```
If prompted to proceed in a non-empty directory, choose **Yes**. If prompted about Turbopack, choose **No**.
Expected: `Success! Created` and a populated `src/app/` tree.

- [ ] **Step 3: Restore preserved files**

```bash
cd ~/smb-tutorials
mv /tmp/smb-preserve/CLAUDE.md /tmp/smb-preserve/project_state.md .
```

- [ ] **Step 4: Replace the home page with a placeholder**

Overwrite `src/app/page.tsx`:
```tsx
export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-3xl font-bold">SMB Tutorials</h1>
      <p className="text-gray-600">1:1 tutoring over video — coming soon.</p>
      <a href="/call" className="rounded bg-black px-4 py-2 text-white">
        Try the call spike
      </a>
    </main>
  );
}
```

- [ ] **Step 5: Run the dev server and verify it responds**

```bash
cd ~/smb-tutorials
npm run dev &
sleep 5
curl -s http://localhost:3000 | grep -o "SMB Tutorials"
kill %1
```
Expected: prints `SMB Tutorials`.

- [ ] **Step 6: Commit and push**

```bash
cd ~/smb-tutorials
git add -A
git fetch origin main && git rebase origin/main
git commit -m "feat: scaffold Next.js app with placeholder home"
git push origin main
```
Expected: push succeeds to `origin/main`.

- [ ] **Step 7: Import the repo into Vercel and verify auto-deploy**

Manual (dashboard):
1. https://vercel.com/new → **Import** the `smb-tutorials` repo (grant Vercel access to only this repo when asked).
2. Framework auto-detects **Next.js**. Leave defaults. **Deploy**.
3. Open the assigned `*.vercel.app` URL.

Expected: the live page shows "SMB Tutorials". Verify the loop: change the `<p>` text, commit, push — a new deploy appears in Vercel and the live URL updates.

---

## Task 2: Daily room create-or-get serverless route

**Files:**
- Create: `src/lib/daily.ts`
- Create: `src/app/api/rooms/route.ts`
- Test: `src/lib/daily.test.ts`
- Create: `vitest.config.ts`
- Modify: `package.json` (add `test` script + dev deps)

**Interfaces:**
- Consumes: `process.env.DAILY_API_KEY` (server-only), `@/*` alias from Task 1.
- Produces:
  - `getOrCreateRoom(name: string, apiKey: string, fetchImpl?: typeof fetch): Promise<{ url: string; name: string }>` — exported from `src/lib/daily.ts`.
  - `POST /api/rooms` — request body `{ name?: string }`; returns `200 { url: string, name: string }` or `500 { error: string }`. If `name` is omitted, a random name (`smb-` + 8 hex chars) is generated. Task 3's `/call` page calls this.

- [ ] **Step 1: Add Vitest and a test script**

```bash
cd ~/smb-tutorials
npm install -D vitest
```
Then in `package.json`, add to the `"scripts"` object:
```json
"test": "vitest run"
```

- [ ] **Step 2: Create the Vitest config**

Create `vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: { environment: "node" },
  resolve: { alias: { "@": resolve(__dirname, "src") } },
});
```

- [ ] **Step 3: Write the failing test**

Create `src/lib/daily.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { getOrCreateRoom } from "@/lib/daily";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("getOrCreateRoom", () => {
  it("returns the existing room when lookup succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, { url: "https://x.daily.co/abc", name: "abc" })
      );
    const room = await getOrCreateRoom("abc", "key", fetchMock as unknown as typeof fetch);
    expect(room).toEqual({ url: "https://x.daily.co/abc", name: "abc" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("creates the room when lookup returns 404", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(404, {}))
      .mockResolvedValueOnce(
        jsonResponse(200, { url: "https://x.daily.co/new", name: "new" })
      );
    const room = await getOrCreateRoom("new", "key", fetchMock as unknown as typeof fetch);
    expect(room).toEqual({ url: "https://x.daily.co/new", name: "new" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws when the api key is missing", async () => {
    await expect(
      getOrCreateRoom("x", "", vi.fn() as unknown as typeof fetch)
    ).rejects.toThrow("DAILY_API_KEY is not set");
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd ~/smb-tutorials && npm test`
Expected: FAIL — cannot resolve `@/lib/daily` (module not found).

- [ ] **Step 5: Implement the helper**

Create `src/lib/daily.ts`:
```ts
const DAILY_API = "https://api.daily.co/v1";

export interface Room {
  url: string;
  name: string;
}

export async function getOrCreateRoom(
  name: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch
): Promise<Room> {
  if (!apiKey) throw new Error("DAILY_API_KEY is not set");

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  const existing = await fetchImpl(`${DAILY_API}/rooms/${name}`, { headers });
  if (existing.ok) {
    const data = await existing.json();
    return { url: data.url, name: data.name };
  }
  if (existing.status !== 404) {
    throw new Error(`Daily lookup failed: ${existing.status}`);
  }

  const created = await fetchImpl(`${DAILY_API}/rooms`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name, properties: { enable_prejoin_ui: true } }),
  });
  if (!created.ok) throw new Error(`Daily create failed: ${created.status}`);
  const data = await created.json();
  return { url: data.url, name: data.name };
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd ~/smb-tutorials && npm test`
Expected: PASS — 3 passed.

- [ ] **Step 7: Create the API route**

Create `src/app/api/rooms/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { getOrCreateRoom } from "@/lib/daily";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const name =
    typeof body.name === "string" && body.name.length > 0
      ? body.name
      : `smb-${crypto.randomUUID().slice(0, 8)}`;
  try {
    const room = await getOrCreateRoom(name, process.env.DAILY_API_KEY ?? "");
    return NextResponse.json(room);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
```

- [ ] **Step 8: Verify the route end-to-end against Daily (requires `.env.local` from P3)**

```bash
cd ~/smb-tutorials
npm run dev &
sleep 5
curl -s -X POST http://localhost:3000/api/rooms -H "Content-Type: application/json" -d '{}'
kill %1
```
Expected: JSON like `{"url":"https://<your-domain>.daily.co/smb-xxxxxxxx","name":"smb-xxxxxxxx"}` (a real room URL). If you see `{"error":"DAILY_API_KEY is not set"}`, complete P3 first.

- [ ] **Step 9: Commit and push**

```bash
cd ~/smb-tutorials
git add -A
git fetch origin main && git rebase origin/main
git commit -m "feat: add Daily room create-or-get API route with tests"
git push origin main
```

---

## Task 3: Video call page (join + share link)

**Files:**
- Create: `src/lib/share.ts`
- Test: `src/lib/share.test.ts`
- Create: `src/app/call/page.tsx`
- Modify: `package.json` (add `@daily-co/daily-js`)

**Interfaces:**
- Consumes: `POST /api/rooms` (Task 2), `@/*` alias.
- Produces:
  - `buildShareUrl(origin: string, roomName: string): string` — exported from `src/lib/share.ts`; returns `${origin}/call?room=<encoded name>`.
  - `/call` page — a client component that mints/joins a Daily room and shows a copyable invite link. Manual two-browser verification (WebRTC media can't be unit-tested).

- [ ] **Step 1: Write the failing test for the share-url helper**

Create `src/lib/share.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildShareUrl } from "@/lib/share";

describe("buildShareUrl", () => {
  it("builds a /call url carrying the room name, url-encoded", () => {
    expect(buildShareUrl("https://app.com", "smb 1")).toBe(
      "https://app.com/call?room=smb%201"
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/smb-tutorials && npm test`
Expected: FAIL — cannot resolve `@/lib/share`.

- [ ] **Step 3: Implement the helper**

Create `src/lib/share.ts`:
```ts
export function buildShareUrl(origin: string, roomName: string): string {
  return `${origin}/call?room=${encodeURIComponent(roomName)}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/smb-tutorials && npm test`
Expected: PASS — all tests pass.

- [ ] **Step 5: Install the Daily client SDK**

```bash
cd ~/smb-tutorials
npm install @daily-co/daily-js
```

- [ ] **Step 6: Create the call page**

Create `src/app/call/page.tsx`:
```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import DailyIframe, { DailyCall } from "@daily-co/daily-js";
import { buildShareUrl } from "@/lib/share";

export default function CallPage() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [shareUrl, setShareUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let frame: DailyCall | null = null;

    (async () => {
      const params = new URLSearchParams(window.location.search);
      const requested = params.get("room") ?? undefined;

      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requested ? { name: requested } : {}),
      });
      const room = await res.json();
      if (!res.ok) {
        setError(room.error ?? "Failed to create room");
        return;
      }

      setShareUrl(buildShareUrl(window.location.origin, room.name));

      // React strict mode double-invokes effects in dev; guard against a duplicate frame.
      if (DailyIframe.getCallInstance() || !wrapRef.current) return;

      frame = DailyIframe.createFrame(wrapRef.current, {
        showLeaveButton: true,
        iframeStyle: { width: "100%", height: "100%", border: "0" },
      });
      await frame.join({ url: room.url });
    })();

    return () => {
      frame?.destroy();
    };
  }, []);

  return (
    <main className="flex h-screen flex-col">
      <div className="flex items-center gap-3 p-3 text-sm">
        <span className="font-medium">SMB Tutorials — Call spike</span>
        {shareUrl && (
          <button
            className="rounded bg-black px-3 py-1 text-white"
            onClick={() => navigator.clipboard.writeText(shareUrl)}
          >
            Copy invite link
          </button>
        )}
        {error && <span className="text-red-600">{error}</span>}
      </div>
      <div ref={wrapRef} className="flex-1" />
    </main>
  );
}
```

- [ ] **Step 7: Manual two-browser verification (local)**

```bash
cd ~/smb-tutorials
npm run dev
```
1. Open http://localhost:3000/call in browser window A → allow camera/mic → you should see your own video and a room is created.
2. Click **Copy invite link**, paste the URL into browser window B (or a second device on your network using your machine's LAN IP instead of localhost).
3. Both windows should show each other's video/audio.

Expected: two-way live video between the two windows. This proves signaling + STUN + TURN via Daily end-to-end.

- [ ] **Step 8: Commit, push, and verify on production**

```bash
cd ~/smb-tutorials
npm run build
git add -A
git fetch origin main && git rebase origin/main
git commit -m "feat: add /call video spike page with Daily prebuilt iframe"
git push origin main
```
Expected: `npm run build` succeeds; push triggers a Vercel deploy. Then open `https://<your-app>.vercel.app/call` in two browsers/devices (ensure `DAILY_API_KEY` is set in Vercel per P4) and confirm two-way video. Production over HTTPS also exercises TURN across real networks.

---

## Self-Review

**1. Spec coverage (M0 scope = "deploy skeleton + two-browser video spike"):**
- Next.js repo → GitHub → Vercel auto-deploy with placeholder page → Task 1. ✅
- Wire Daily.co (serverless room provisioning without running a server) → Task 2. ✅
- Two browsers into a video call → Task 3 (steps 7–8). ✅
- Serverless-only / secrets in env → Global Constraints + Prerequisites (P3/P4) + Task 2 (server-only key). ✅
- Preserve existing repo/files → Task 1 (steps 1, 3). ✅

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"write tests for the above". Every code step shows complete code; every command shows expected output. ✅

**3. Type consistency:** `getOrCreateRoom(name, apiKey, fetchImpl?)` returning `{ url, name }` is defined in Task 2 and consumed identically by the route and (via `/api/rooms`) by Task 3. `buildShareUrl(origin, roomName)` defined and used consistently. `@/*` alias established in Task 1, used in all later imports. ✅

**Known gotcha documented:** React strict-mode double-mount creating a duplicate Daily frame — guarded via `DailyIframe.getCallInstance()` in Task 3 Step 6.
