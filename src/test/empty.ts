// Vitest has no equivalent to the "react-server" export condition that lets
// `server-only` resolve to a no-op outside a real RSC runtime (its default
// export throws unconditionally — see node_modules/server-only/index.js).
// Next's own Jest docs alias the package to an empty module for tests
// (docs/01-app/02-guides/testing/jest.md: `'server-only': '<rootDir>/__mocks__/empty.js'`);
// this file is that same stub, wired in vitest.config.mts's resolve.alias.
export {};
