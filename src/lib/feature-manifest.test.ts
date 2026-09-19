import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface ManifestTest {
  file: string;
  case: string;
}

interface ManifestInvariant {
  id: string;
  rule: string;
  tests: ManifestTest[];
  guards?: string[];
}

interface FeatureManifest {
  schemaVersion: number;
  features: Array<{
    id: string;
    name: string;
    surfaces: string[];
    invariants: ManifestInvariant[];
  }>;
}

const root = process.cwd();
const manifest = JSON.parse(
  readFileSync(resolve(root, 'FEATURE_MANIFEST.json'), 'utf8')
) as FeatureManifest;

describe('feature manifest', () => {
  it('keeps every product invariant linked to executable regression coverage', () => {
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.features.length).toBeGreaterThan(0);

    const invariantIds = manifest.features.flatMap((feature) =>
      feature.invariants.map((invariant) => invariant.id)
    );
    expect(new Set(invariantIds).size).toBe(invariantIds.length);

    for (const feature of manifest.features) {
      expect(feature.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(feature.name.trim()).not.toBe('');
      expect(feature.surfaces.length).toBeGreaterThan(0);
      expect(feature.invariants.length).toBeGreaterThan(0);

      for (const invariant of feature.invariants) {
        expect(invariant.id).toMatch(/^[A-Z]+-[0-9]{3}$/);
        expect(invariant.rule.trim()).not.toBe('');
        expect(invariant.tests.length).toBeGreaterThan(0);

        for (const regression of invariant.tests) {
          const contents = readFileSync(resolve(root, regression.file), 'utf8');
          expect(contents).toContain(regression.case);
        }

        for (const guard of invariant.guards ?? []) {
          expect(() =>
            readFileSync(resolve(root, guard), 'utf8')
          ).not.toThrow();
        }
      }
    }
  });

  it('keeps the calendar basics explicit across every delivery surface', () => {
    const calendar = manifest.features.find(
      (feature) => feature.id === 'calendar'
    );
    expect(calendar?.surfaces).toEqual(['web', 'mobile', 'whatsapp']);
    expect(calendar?.invariants.map((invariant) => invariant.id)).toEqual([
      'CAL-001',
      'CAL-002',
      'CAL-003',
      'CAL-004',
      'CAL-005',
      'CAL-006',
      'CAL-007',
    ]);
  });
});
