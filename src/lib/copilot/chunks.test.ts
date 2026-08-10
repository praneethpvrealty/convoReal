import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHUNKS, chunkVersion, getChunk, isCurrentChunk } from './chunks';
import { KNOWLEDGE_INDEX } from './knowledge-index.gen';
import { anchorChunkFor } from './retrieval';

const KINDS = ['page', 'concept', 'howto', 'limit'] as const;

/**
 * Dashboard areas deliberately without helper knowledge. Adding a
 * route here is a conscious decision — anything not listed must ship
 * with a page chunk or the coverage test below fails.
 */
const UNCOVERED_ROUTES = ['/admin', '/checkout-demo', '/dev'];

function containsPage(dir: string): boolean {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name === 'page.tsx') return true;
    if (entry.isDirectory() && containsPage(path.join(dir, entry.name)))
      return true;
  }
  return false;
}

/** Top-level dashboard areas with at least one routable page,
 *  discovered from the filesystem — a new page directory fails
 *  coverage without anyone remembering to update a list. */
function discoverDashboardAreas(): string[] {
  const base = path.join(process.cwd(), 'src/app/(dashboard)');
  return fs
    .readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory() && containsPage(path.join(base, e.name)))
    .map((e) => `/${e.name}`);
}

describe('knowledge chunk registry', () => {
  it('has unique ids in area.topic form', () => {
    const ids = CHUNKS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id, id).toMatch(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/);
    }
  });

  it('keeps bodies helper-sized (2-4 sentences, ≤400 chars)', () => {
    for (const chunk of CHUNKS) {
      expect(chunk.kind, chunk.id).toBeOneOf([...KINDS]);
      expect(chunk.title.length, chunk.id).toBeGreaterThan(2);
      expect(chunk.body.length, chunk.id).toBeGreaterThanOrEqual(100);
      expect(chunk.body.length, chunk.id).toBeLessThanOrEqual(400);
    }
  });

  it('anchors every page chunk to a dashboard route', () => {
    for (const chunk of CHUNKS.filter((c) => c.kind === 'page')) {
      expect(chunk.route, chunk.id).toMatch(/^\/[a-z]/);
    }
  });

  it('keeps keywords lowercase (lexical matching is lowercase)', () => {
    for (const chunk of CHUNKS) {
      for (const kw of chunk.keywords ?? []) {
        expect(kw, `${chunk.id}: ${kw}`).toBe(kw.toLowerCase());
      }
    }
  });

  it('covers every dashboard area on disk (the future-proofing gate)', () => {
    const areas = discoverDashboardAreas().filter(
      (r) => !UNCOVERED_ROUTES.includes(r)
    );
    // Floor guards the directory scan itself — if it ever returns a
    // handful of routes, the scan broke, not the corpus.
    expect(areas.length).toBeGreaterThanOrEqual(15);
    for (const area of areas) {
      expect(
        anchorChunkFor(area),
        `${area} has no page chunk — add one to chunks.ts (or list the route in UNCOVERED_ROUTES if the helper should stay silent about it)`
      ).toBeTruthy();
    }
  });

  it('gives limit chunks a supported alternative, not just a "no"', () => {
    for (const chunk of CHUNKS.filter((c) => c.kind === 'limit')) {
      expect(chunk.body.length, chunk.id).toBeGreaterThan(120);
    }
  });
});

describe('chunk versioning', () => {
  it('is stable for identical content and moves with any edit', () => {
    const chunk = CHUNKS[0];
    expect(chunkVersion(chunk)).toBe(chunkVersion({ ...chunk }));
    expect(chunkVersion(chunk)).not.toBe(
      chunkVersion({ ...chunk, body: chunk.body + ' edited' })
    );
    expect(chunkVersion(chunk)).toMatch(/^[0-9a-f]{8}$/);
  });

  it('isCurrentChunk accepts live versions and rejects stale/unknown', () => {
    const chunk = CHUNKS[0];
    expect(isCurrentChunk(chunk.id, chunkVersion(chunk))).toBe(true);
    expect(isCurrentChunk(chunk.id, 'deadbeef')).toBe(false);
    expect(isCurrentChunk('no.such-chunk', 'deadbeef')).toBe(false);
    expect(getChunk(chunk.id)).toBe(chunk);
  });
});

describe('semantic index freshness', () => {
  it('matches the corpus exactly when populated (run npm run copilot:index after editing chunks)', () => {
    const entries = Object.entries(KNOWLEDGE_INDEX);
    if (entries.length === 0) return; // index not generated yet — lexical fallback serves
    const liveIds = new Set(CHUNKS.map((c) => c.id));
    for (const [id, entry] of entries) {
      expect(liveIds.has(id), `orphan index entry ${id}`).toBe(true);
      expect(
        isCurrentChunk(id, entry.v),
        `stale index entry ${id} — run npm run copilot:index`
      ).toBe(true);
      expect(entry.embedding.length, id).toBe(768);
    }
    for (const chunk of CHUNKS) {
      expect(
        KNOWLEDGE_INDEX[chunk.id],
        `chunk ${chunk.id} missing from index — run npm run copilot:index`
      ).toBeTruthy();
    }
  });
});
