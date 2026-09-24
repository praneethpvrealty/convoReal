import { unstable_cache } from 'next/cache';

import { supabaseAdmin } from '@/lib/supabase/admin';

export interface GuidanceCoverage {
  district: string;
  notifications: number;
  latest: string | null;
}

export const cachedGuidanceCoverage = unstable_cache(
  async (): Promise<GuidanceCoverage[]> => {
    const { data, error } = await supabaseAdmin()
      .from('guidance_value_sources')
      .select('district, effective_from')
      .in('status', ['parsing', 'ready'])
      .order('district');
    if (error || !data) return [];

    const byDistrict = new Map<string, GuidanceCoverage>();
    for (const row of data as Array<{
      district: string;
      effective_from: string | null;
    }>) {
      const district = row.district.trim();
      if (!district) continue;
      const entry = byDistrict.get(district) ?? {
        district,
        notifications: 0,
        latest: null,
      };
      entry.notifications += 1;
      if (
        row.effective_from &&
        (!entry.latest || row.effective_from > entry.latest)
      ) {
        entry.latest = row.effective_from;
      }
      byDistrict.set(district, entry);
    }
    return [...byDistrict.values()];
  },
  ['guidance-coverage'],
  { revalidate: 3600 }
);
