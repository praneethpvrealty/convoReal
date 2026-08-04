// Shared setup for tests that opt into jsdom via
// `// @vitest-environment jsdom`. A no-op under the default node
// environment, so the fast suite is unaffected.
//
// jsdom implements the DOM but not the browser APIs that depend on
// layout. A component observing its own size throws on mount without
// this; the stub never fires, which is honest — jsdom has no layout to
// report, and any test relying on a measured size would be fiction.
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
