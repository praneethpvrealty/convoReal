import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/showcase/account-showcase-url', () => ({
  accountPropertiesShowcaseUrl: async (
    _db: unknown,
    _accountId: string,
    properties: { id: string }[]
  ) => `https://x.test/?ids=${properties.map((p) => p.id).join(',')}`,
}));

const {
  NEAR_MISS_SCAN_LIMIT,
  areaNearMissLine,
  buildAreaNearMissLine,
  findAreaNearMiss,
} = await import('./area-near-misses');

const suryanagarPlot = {
  id: 'p1',
  title: 'North facing 50x80 Semi-Commercial Plot in Suryanagar Phase 1',
  price: 60_000_000,
  listing_type: 'Sale' as const,
  sublocality: 'Suryanagar phase 1',
};
const suryaCityPlot = {
  id: 'p2',
  title: '3933 Sq.Ft. North East corner Residential Plot in Surya city phase 3',
  price: 24_000_000,
  listing_type: 'Sale' as const,
  location: 'Surya city phase 3, Bangalore, Karnataka',
};
const suryaCityRental = {
  id: 'p3',
  title: 'Shop for rent in Surya City',
  price: 40_000,
  listing_type: 'Rent' as const,
  location: 'Surya City, Chandapura',
};

describe('findAreaNearMiss', () => {
  it("[INB-015] finds the lead's own locality at any price, cheapest first, same deal type only", () => {
    const nearMiss = findAreaNearMiss(
      [suryanagarPlot, suryaCityRental, suryaCityPlot] as never,
      { areas: ['KHB Suryanagar Phase'], listingTypes: ['Sale'] }
    );
    expect(nearMiss?.properties.map((p) => p.id)).toEqual(['p2', 'p1']);
    expect(nearMiss?.minPrice).toBe(24_000_000);
    expect(nearMiss?.maxPrice).toBe(60_000_000);
  });

  it('returns null when the areas hold no live stock', () => {
    expect(
      findAreaNearMiss([suryanagarPlot] as never, {
        areas: ['Whitefield'],
        listingTypes: ['Sale'],
      })
    ).toBeNull();
  });
});

describe('buildAreaNearMissLine', () => {
  const nearMiss = findAreaNearMiss([suryanagarPlot, suryaCityPlot] as never, {
    areas: ['KHB Suryanagar Phase'],
    listingTypes: [],
  })!;

  it('[INB-015] states the count, the price band and that it is above budget', () => {
    expect(
      buildAreaNearMissLine(
        nearMiss,
        { budgetMin: 3_000_000, budgetMax: 3_500_000, listingTypes: [] },
        'https://x.test/?ids=P1,P2'
      )
    ).toBe(
      '📍 We do have 2 listings in KHB Suryanagar Phase, at ₹2.4 Cr–₹6 Cr — above your budget. Take a look: https://x.test/?ids=P1,P2'
    );
  });

  it('says nothing about budget when none is known', () => {
    expect(
      buildAreaNearMissLine(
        nearMiss,
        { budgetMin: null, budgetMax: null, listingTypes: [] },
        'https://x.test'
      )
    ).not.toContain('budget');
  });
});

const suryaCityShop = {
  id: 'r1',
  title: 'Shop for rent in Surya City',
  price: 0,
  rent_per_month: 40_000,
  listing_type: 'Rent' as const,
  location: 'Surya City, Chandapura',
};
const suryaCityOffice = {
  id: 'r2',
  title: 'Office for rent in Surya City',
  price: 90_000_000,
  rent_per_month: 25_000,
  listing_type: 'Rent' as const,
  location: 'Surya City, Chandapura',
};
const untypedPlot = {
  id: 'u1',
  title: 'Plot in Surya City',
  price: 5_000_000,
  listing_type: null,
  location: 'Surya City, Chandapura',
};

describe('area near-misses by deal type', () => {
  it('[INB-015] prices rentals on monthly rent, as the matching engine does', () => {
    const nearMiss = findAreaNearMiss(
      [suryaCityShop, suryaCityOffice] as never,
      { areas: ['Surya City'], listingTypes: ['Rent'] }
    )!;
    expect(nearMiss.properties.map((p) => p.id)).toEqual(['r2', 'r1']);
    expect(nearMiss.minPrice).toBe(25_000);
    expect(nearMiss.maxPrice).toBe(40_000);
    expect(
      buildAreaNearMissLine(
        nearMiss,
        { budgetMin: null, budgetMax: 20_000, listingTypes: ['Rent'] },
        'https://x.test'
      )
    ).toBe(
      '📍 We do have 2 listings in Surya City, at ₹25,000–₹40,000 a month — above your budget. Take a look: https://x.test'
    );
  });

  it('[INB-015] never judges a rent band against a purchase budget', () => {
    const nearMiss = findAreaNearMiss([suryaCityShop] as never, {
      areas: ['Surya City'],
      listingTypes: [],
    })!;
    expect(nearMiss.listingType).toBe('Rent');
    expect(
      buildAreaNearMissLine(
        nearMiss,
        { budgetMin: 3_000_000, budgetMax: 3_500_000, listingTypes: [] },
        'https://x.test'
      )
    ).not.toContain('budget');
  });

  it('[INB-015] treats an untyped listing as Sale and keeps it from a rent-only lead', () => {
    expect(
      findAreaNearMiss([untypedPlot] as never, {
        areas: ['Surya City'],
        listingTypes: ['Rent'],
      })
    ).toBeNull();
    expect(
      findAreaNearMiss([untypedPlot] as never, {
        areas: ['Surya City'],
        listingTypes: ['Sale'],
      })?.properties.map((p) => p.id)
    ).toEqual(['u1']);
  });

  it('[INB-015] never mixes deal types in one band, and offers no niche deal unasked', () => {
    const jv = {
      id: 'j1',
      title: 'JV land in Surya City',
      price: 1_000_000,
      listing_type: 'JV/JD' as const,
      location: 'Surya City',
    };
    const nearMiss = findAreaNearMiss(
      [jv, suryaCityShop, untypedPlot] as never,
      { areas: ['Surya City'], listingTypes: [] }
    )!;
    expect(nearMiss.listingType).toBe('Sale');
    expect(nearMiss.properties.map((p) => p.id)).toEqual(['u1']);
  });
});

function recordingDb(rows: Record<string, unknown>[]) {
  const calls: [string, ...unknown[]][] = [];
  const query: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'or', 'gt', 'order', 'limit']) {
    query[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return query;
    };
  }
  query.then = (resolve: (value: { data: unknown[] }) => unknown) =>
    Promise.resolve({ data: rows }).then(resolve);
  return { db: { from: () => query } as never, calls };
}

describe('areaNearMissLine', () => {
  it('[INB-015] narrows by locality, deal type and price in SQL and bounds the scan', async () => {
    const { db, calls } = recordingDb([suryaCityShop, suryaCityOffice]);
    await areaNearMissLine({
      db,
      accountId: 'acct',
      contactId: 'c1',
      brief: {
        areas: ['Surya City'],
        listingTypes: ['Rent'],
        budgetMin: null,
        budgetMax: null,
      },
    });
    expect(calls).toContainEqual(['eq', 'account_id', 'acct']);
    expect(calls).toContainEqual(['eq', 'listing_type', 'Rent']);
    expect(calls).toContainEqual(['gt', 'rent_per_month', 0]);
    expect(calls).toContainEqual([
      'order',
      'rent_per_month',
      { ascending: true },
    ]);
    expect(calls).toContainEqual(['limit', NEAR_MISS_SCAN_LIMIT]);
    expect(
      calls.some(
        ([method, filter]) =>
          method === 'or' &&
          String(filter).includes('sublocality.ilike."%surya%"')
      )
    ).toBe(true);
  });

  it('[INB-015] admits untyped rows into the Sale scan in SQL', async () => {
    const { db, calls } = recordingDb([untypedPlot]);
    const line = await areaNearMissLine({
      db,
      accountId: 'acct',
      contactId: 'c1',
      brief: {
        areas: ['Surya City'],
        listingTypes: ['Sale'],
        budgetMin: null,
        budgetMax: null,
      },
    });
    expect(line).toContain('1 listing in Surya City, at ₹50 L');
    expect(calls).toContainEqual([
      'or',
      'listing_type.is.null,listing_type.not.in.("Rent","JV/JD","Built to Suit")',
    ]);
    expect(calls).toContainEqual(['gt', 'price', 0]);
  });

  it('[INB-015] says the link carries only the listings closest to budget when there are more', async () => {
    const rows = [1, 2, 3, 4, 5, 6, 7].map((n) => ({
      id: `s${n}`,
      title: `Plot ${n} in Surya City`,
      price: n * 10_000_000,
      listing_type: 'Sale',
      location: 'Surya City',
    }));
    const { db } = recordingDb(rows);
    const line = await areaNearMissLine({
      db,
      accountId: 'acct',
      contactId: 'c1',
      brief: {
        areas: ['Surya City'],
        listingTypes: ['Sale'],
        budgetMin: 55_000_000,
        budgetMax: 60_000_000,
      },
    });
    expect(line).toBe(
      '📍 We do have 7 listings in Surya City, at ₹1 Cr–₹7 Cr. Here are the 5 closest to your budget: https://x.test/?ids=s6,s5,s7,s4,s3'
    );
  });

  it('[INB-015] owns up to a scan that hit its bound', async () => {
    const rows = Array.from({ length: NEAR_MISS_SCAN_LIMIT }, (_, n) => ({
      id: `s${n}`,
      title: `Plot ${n} in Surya City`,
      price: 10_000_000 + n,
      listing_type: 'Sale',
      location: 'Surya City',
    }));
    const { db } = recordingDb(rows);
    const line = await areaNearMissLine({
      db,
      accountId: 'acct',
      contactId: 'c1',
      brief: {
        areas: ['Surya City'],
        listingTypes: ['Sale'],
        budgetMin: null,
        budgetMax: null,
      },
    });
    expect(line).toBe(
      `📍 We do have ${NEAR_MISS_SCAN_LIMIT}+ listings in Surya City, from ₹1 Cr. Here are the 5 most affordable: https://x.test/?ids=s0,s1,s2,s3,s4`
    );
  });
});

function inventoryDb(rows: Record<string, number | string>[]) {
  return {
    from: () => {
      let result = [...rows];
      const query: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'or']) query[method] = () => query;
      query.gt = (column: string, value: number) => {
        result = result.filter((row) => Number(row[column]) > value);
        return query;
      };
      query.gte = (column: string, value: number) => {
        result = result.filter((row) => Number(row[column]) >= value);
        return query;
      };
      query.lt = (column: string, value: number) => {
        result = result.filter((row) => Number(row[column]) < value);
        return query;
      };
      query.order = (column: string, { ascending }: { ascending: boolean }) => {
        result.sort(
          (a, b) =>
            (Number(a[column]) - Number(b[column])) * (ascending ? 1 : -1)
        );
        return query;
      };
      query.limit = (n: number) => {
        result = result.slice(0, n);
        return query;
      };
      query.then = (resolve: (value: { data: unknown[] }) => unknown) =>
        Promise.resolve({ data: result }).then(resolve);
      return query;
    },
  } as never;
}

describe('areaNearMissLine past the scan bound', () => {
  it('[INB-015] links the listings closest to a budget above the cheapest scanned rows', async () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({
      id: `s${i + 1}`,
      title: `Plot ${i + 1} in Surya City`,
      price: (i + 1) * 10_000_000,
      listing_type: 'Sale',
      location: 'Surya City',
    }));
    const line = await areaNearMissLine({
      db: inventoryDb(rows),
      accountId: 'acct',
      contactId: 'c1',
      brief: {
        areas: ['Surya City'],
        listingTypes: ['Sale'],
        budgetMin: 2_400_000_000,
        budgetMax: 2_450_000_000,
      },
    });
    expect(line).toBe(
      `📍 We do have ${NEAR_MISS_SCAN_LIMIT}+ listings in Surya City, from ₹1 Cr. Here are the 5 closest to your budget: https://x.test/?ids=s240,s241,s242,s243,s244`
    );
  });
});
