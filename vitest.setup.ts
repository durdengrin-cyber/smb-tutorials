import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Testing Library's own auto-cleanup only self-registers when it finds a
// global `afterEach` at import time (its check is `typeof afterEach ===
// "function"`). This project's vitest config does not set `test.globals`,
// so no test file has a global `afterEach` — every jsdom component test
// that renders more than once across separate `it()` blocks leaks DOM
// nodes from one test into the next. Wiring it here, once, is the fix at
// the root: `cleanup()` no-ops when nothing was ever rendered (its loop is
// over what Testing Library itself tracked), so this is inert for every
// existing "node"-environment test.
afterEach(() => {
  cleanup();
});
