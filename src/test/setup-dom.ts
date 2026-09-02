// Shared setup for tests that opt into a DOM via
// `// @vitest-environment happy-dom`. A no-op under the default node
// environment, so the fast suite is unaffected.
//
// happy-dom rather than jsdom: jsdom 30 pulls undici 8, which calls
// worker_threads.markAsUncloneable — a Node 22 API. happy-dom keeps
// this environment smaller and avoids coupling component tests to
// undici internals.
//
// A DOM environment implements the DOM but not the browser APIs that
// depend on layout. A component observing its own size throws on mount
// without this; the stub never fires, which is honest — there is no
// layout to report, and a test relying on a measured size would be
// asserting fiction.
//
// Reached through globalThis rather than `'X' in window`: lib.dom
// declares these, so the `in` guard narrows window to never and the
// assignment stops type-checking.

class ResizeObserverStub implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const globals = globalThis as { window?: unknown; ResizeObserver?: unknown };

if (globals.window !== undefined && globals.ResizeObserver === undefined) {
  globals.ResizeObserver = ResizeObserverStub;
}
