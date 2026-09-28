import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SPEC_DEFAULT_STAGES } from './default-stages';

const migration = (name: string) =>
  readFileSync(join(process.cwd(), 'supabase/migrations', name), 'utf8');

const typeMigration = migration('20260928093000_pipeline_stage_type.sql');
const byTypeMigration = migration('20260928094000_pipeline_stages_by_type.sql');
const genericMigration = migration(
  '20260928123000_generic_pipelines_to_standard_stages.sql'
);
const webSemantics = readFileSync(
  join(process.cwd(), 'src/lib/pipelines/stage-semantics.ts'),
  'utf8'
);
const mobileSemantics = readFileSync(
  join(process.cwd(), 'mobile/lib/stage-semantics.ts'),
  'utf8'
);

function body(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  return source.slice(start, source.indexOf(to, start));
}

describe('[PRP-015] stage type is inferred and read the same way everywhere', () => {
  it('infers a type from the same words in SQL and TypeScript', () => {
    const inference = body(
      webSemantics,
      'export function inferStageType(',
      'export function stageTypeOf('
    );
    const words = [...inference.matchAll(/name\.includes\('([^']+)'\)/g)].map(
      (m) => m[1]
    );
    expect(words.length).toBeGreaterThan(8);
    for (const word of words) {
      expect(typeMigration).toContain(`'%${word}%'`);
    }
  });

  it('seeds the same default stages in SQL as the app', () => {
    for (const stage of SPEC_DEFAULT_STAGES) {
      const sqlName = stage.name.replace(/'/g, "''");
      expect(byTypeMigration).toContain(
        `'${sqlName}', '${stage.color}', ${stage.position}, '${stage.stage_type}')`
      );
    }
  });

  it('moves the generic Sales Pipeline onto the same default stages', () => {
    const renamed = [
      "'Enquiry → Shortlist'",
      "'Shortlisted → Visit'",
      "'Finalised → Owner''s meeting'",
      "'Owner''s meeting → Negotiation'",
      "'Registered → Brokerage'",
    ];
    for (const name of renamed) expect(genericMigration).toContain(name);
    const byPosition = new Map(SPEC_DEFAULT_STAGES.map((s) => [s.position, s]));
    for (const position of [4, 5, 7, 8]) {
      const stage = byPosition.get(position)!;
      expect(genericMigration).toContain(
        `(p.id, '${stage.name}', '${stage.color}', ${position}, '${stage.stage_type}')`
      );
    }
    expect(genericMigration).toContain(
      "ARRAY['open', 'open', 'open', 'open', 'brokerage_pending']"
    );
    expect(genericMigration).toContain('ARRAY[0, 1, 2, 3, 6]');
  });

  it('reads listing status, brokerage paid and the journey kind from the type', () => {
    expect(byTypeMigration).toContain("WHEN s.stage_type = 'committed' THEN 1");
    expect(byTypeMigration).toContain(
      "IF target_stage_type = 'brokerage_paid' THEN"
    );
    expect(byTypeMigration).toContain(
      'stage_kind = journey_stage_kind_for_stage_type(ps.stage_type)'
    );
    expect(byTypeMigration).not.toMatch(
      /LIKE '%(token|negotiation|contract)%'/
    );
  });

  it('keeps the mobile copy of the stage rules identical to the web', () => {
    const shared = (source: string) =>
      body(
        source,
        'export function inferStageType(',
        'export function isLostStage('
      );
    expect(shared(mobileSemantics)).toBe(shared(webSemantics));
    expect(
      body(
        mobileSemantics,
        'export function pipelineOutcomeForStage(',
        'export function dealStatusForStage('
      )
    ).toBe(
      body(
        webSemantics,
        'export function pipelineOutcomeForStage(',
        'export function dealStatusForStage('
      )
    );
  });
});
