import { describe, expect, it } from 'vitest';
import { buildProjectLookupPrompt, toAiDiscoveredProject } from './ai-discovery';

describe('toAiDiscoveredProject', () => {
  it('drops a model-supplied RERA number and marks the row unverified', () => {
    const row = toAiDiscoveredProject({
      name: ' Lakeview ',
      project_type: 'Villa',
      rera_registration_number: 'PRM/KA/RERA/1251/446/PR/180517/001713',
    });
    expect(row).toMatchObject({ name: 'Lakeview', source: 'ai', rera_registration_number: null });
  });

  it('rejects answers with no name', () => {
    expect(toAiDiscoveredProject(null)).toBeNull();
    expect(toAiDiscoveredProject({ promoter_name: 'X' })).toBeNull();
    expect(toAiDiscoveredProject([{ name: 'A' }])).toBeNull();
  });

  it('coerces unknown project types and junk numbers', () => {
    expect(
      toAiDiscoveredProject({ name: 'A', project_type: 'Castle', total_units: -4, total_land_area: '12' }),
    ).toMatchObject({ project_type: 'Flat/ Apartment', total_units: null, total_land_area: null });
  });
});

describe('buildProjectLookupPrompt', () => {
  it('never asks the model for a RERA number', () => {
    expect(buildProjectLookupPrompt('Lakeview')).not.toMatch(/rera/i);
  });
});
