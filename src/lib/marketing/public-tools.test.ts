import { describe, expect, it } from 'vitest';

import { WORKFLOW_TEMPLATES } from '@/lib/liaisons/workflow-templates';
import {
  GUIDANCE_TOOL_PATH,
  GUIDANCE_VALUE_FAQ,
  PROCESS_GUIDES,
  PROCESS_GUIDES_PATH,
  PUBLIC_TOOLS,
  TOOLS_PATH,
  durationText,
  findProcessGuide,
  processDuration,
  publicToolPaths,
} from './public-tools';

describe('process guides', () => {
  it('[PUB-002] publishes every liaison workflow template as a process guide', () => {
    expect(PROCESS_GUIDES).toHaveLength(WORKFLOW_TEMPLATES.length);
    for (const template of WORKFLOW_TEMPLATES) {
      const guide = PROCESS_GUIDES.find((entry) => entry.key === template.key);
      expect(guide).toBeDefined();
      expect(guide?.slug).toMatch(/^[a-z0-9-]+$/);
      expect(guide?.title).toBe(template.service_name);
      expect(guide?.stages).toBe(template.stages);
      expect(findProcessGuide(guide!.slug)).toBe(guide);
    }
    expect(new Set(PROCESS_GUIDES.map((guide) => guide.slug)).size).toBe(
      PROCESS_GUIDES.length
    );
    expect(findProcessGuide('not-a-process')).toBeNull();
  });

  it('[PUB-002] derives the total time, authorities and questions from the stages', () => {
    const guide = findProcessGuide('khata-transfer');
    expect(guide).not.toBeNull();
    expect(guide!.totalDays).toBe(
      guide!.stages.reduce((sum, stage) => sum + (stage.duration_days ?? 0), 0)
    );
    for (const stage of guide!.stages) {
      if (stage.authority)
        expect(guide!.authorities).toContain(stage.authority);
    }
    expect(guide!.faq.map((entry) => entry.question)).toEqual([
      'How long does khata transfer after property purchase take?',
      'What are the stages of khata transfer after property purchase?',
      'Who handles khata transfer after property purchase?',
    ]);
    expect(guide!.faq[0].answer).toContain(`About ${guide!.totalDays} days`);
    for (const stage of guide!.stages) {
      expect(guide!.faq[1].answer).toContain(stage.name);
    }
  });
});

describe('process duration', () => {
  it('[PUB-002] never sums an undated stage into a total', () => {
    const guide = findProcessGuide('builder-reassignment');
    expect(guide).not.toBeNull();
    expect(guide!.undatedStages).toEqual([
      'Sale deed registration at possession',
    ]);
    expect(guide!.totalDays).toBeNull();
    expect(durationText(guide!)).toBe(`at least ${guide!.datedDays} days`);
    expect(guide!.faq[0].answer).toContain(`At least ${guide!.datedDays} days`);
    expect(guide!.faq[0].answer).toContain(
      'Sale deed registration at possession has no fixed duration'
    );

    expect(
      processDuration([
        { name: 'A', authority: null, duration_days: 2, description: null },
        { name: 'B', authority: null, duration_days: 5, description: null },
      ])
    ).toEqual({ totalDays: 7, datedDays: 7, undatedStages: [] });
    expect(
      durationText({ totalDays: 1, datedDays: 1, undatedStages: [] })
    ).toBe('about 1 day');
  });
});

describe('public tool paths', () => {
  it('[PUB-002] lists the hub, every tool and every process guide for the sitemap', () => {
    const paths = publicToolPaths();
    expect(paths).toContain(TOOLS_PATH);
    expect(paths).toContain(GUIDANCE_TOOL_PATH);
    expect(paths).toContain(PROCESS_GUIDES_PATH);
    for (const tool of PUBLIC_TOOLS) expect(paths).toContain(tool.path);
    for (const guide of PROCESS_GUIDES) {
      expect(paths).toContain(`${PROCESS_GUIDES_PATH}/${guide.slug}`);
    }
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('[PUB-002] answers the guidance value questions in full sentences', () => {
    expect(GUIDANCE_VALUE_FAQ.length).toBeGreaterThanOrEqual(5);
    for (const entry of GUIDANCE_VALUE_FAQ) {
      expect(entry.question.endsWith('?')).toBe(true);
      expect(entry.answer.length).toBeGreaterThan(80);
    }
  });
});
