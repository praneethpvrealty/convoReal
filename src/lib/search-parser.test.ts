import { describe, it, expect } from 'vitest';
import { parsePropertyQuery } from './search-parser';

describe('parsePropertyQuery', () => {
  it('should parse range query with double units', () => {
    const res = parsePropertyQuery('residential plots from 2 cr to 3 cr range');
    expect(res.minPrice).toBe(20000000);
    expect(res.maxPrice).toBe(30000000);
    expect(res.types).toContain('Residential Land/ Plot');
    expect(res.remainingSearch).toBe('');
  });

  it('should parse range query with single unit at the end', () => {
    const res = parsePropertyQuery('plots 1.5 to 2.5 cr');
    expect(res.minPrice).toBe(15000000);
    expect(res.maxPrice).toBe(25000000);
    expect(res.types).toContain('Residential Land/ Plot');
    expect(res.remainingSearch).toBe('');
  });

  it('should parse under/below queries', () => {
    const res = parsePropertyQuery('commercial office under 1.5 Cr');
    expect(res.minPrice).toBeNull();
    expect(res.maxPrice).toBe(15000000);
    expect(res.types).toContain('Commercial Office Space');
    expect(res.types).toContain('Office in IT Park/ SEZ');
    expect(res.remainingSearch).toBe('');
  });

  it('should parse above/starting queries', () => {
    const res = parsePropertyQuery('villa above 4 cr in Whitefield');
    expect(res.minPrice).toBe(40000000);
    expect(res.maxPrice).toBeNull();
    expect(res.types).toContain('Villa');
    expect(res.remainingSearch).toBe('whitefield');
  });

  it('should parse exact/around budget queries with tolerance', () => {
    const res = parsePropertyQuery('apartments around 90 lakhs');
    expect(res.minPrice).toBe(9000000 * 0.85);
    expect(res.maxPrice).toBe(9000000 * 1.15);
    expect(res.types).toContain('Flat/ Apartment');
  });

  it('should handle queries with no prices but keywords', () => {
    const res = parsePropertyQuery('villas in Jayanagar');
    expect(res.minPrice).toBeNull();
    expect(res.maxPrice).toBeNull();
    expect(res.types).toContain('Villa');
    expect(res.remainingSearch).toBe('jayanagar');
  });

  it('should fallback to plain text if query has no features', () => {
    const res = parsePropertyQuery('Prestige Blue Waters');
    expect(res.minPrice).toBeNull();
    expect(res.maxPrice).toBeNull();
    expect(res.types).toEqual([]);
    expect(res.remainingSearch).toBe('prestige blue waters');
  });

  it('should parse > operator', () => {
    const res = parsePropertyQuery('price > 50 cr');
    expect(res.minPrice).toBe(500000001);
    expect(res.maxPrice).toBeNull();
    expect(res.types).toEqual([]);
  });

  it('should parse >= operator', () => {
    const res = parsePropertyQuery('price >= 2 Cr');
    expect(res.minPrice).toBe(20000000);
    expect(res.maxPrice).toBeNull();
  });

  it('should parse < operator', () => {
    const res = parsePropertyQuery('budget < 1.5 Cr');
    expect(res.minPrice).toBeNull();
    expect(res.maxPrice).toBe(14999999);
  });

  it('should parse <= operator', () => {
    const res = parsePropertyQuery('<= 80 lakhs');
    expect(res.minPrice).toBeNull();
    expect(res.maxPrice).toBe(8000000);
  });

  it('should parse complex query with operator + type + location', () => {
    const res = parsePropertyQuery('villa > 3 Cr in Whitefield');
    expect(res.minPrice).toBe(30000001);
    expect(res.maxPrice).toBeNull();
    expect(res.types).toContain('Villa');
    expect(res.remainingSearch).toBe('whitefield');
  });

  it('should parse rent yielding queries without misreading rent as listing type', () => {
    const res = parsePropertyQuery('rent yielding commercial > 10 cr');
    expect(res.rentYielding).toBe(true);
    expect(res.listingType).toBe('Sale');
    expect(res.minPrice).toBe(100000001);
    expect(res.maxPrice).toBeNull();
    expect(res.types).toContain('Commercial');
    expect(res.remainingSearch).toBe('');
  });

  it('should detect rent-yield intent from rental yield and pre-leased phrasing', () => {
    const yieldRes = parsePropertyQuery('rental yield office above 5 cr');
    expect(yieldRes.rentYielding).toBe(true);
    expect(yieldRes.listingType).toBe('Sale');
    expect(yieldRes.minPrice).toBe(50000000);
    expect(yieldRes.types).toContain('Commercial Office Space');
    expect(yieldRes.remainingSearch).toBe('');

    const leasedRes = parsePropertyQuery('pre-leased commercial building');
    expect(leasedRes.rentYielding).toBe(true);
    expect(leasedRes.types).toContain('Commercial Building');
    expect(leasedRes.remainingSearch).toBe('');
  });

  it('should still classify plain rent queries as Rent listings', () => {
    const res = parsePropertyQuery('flats for rent in Whitefield');
    expect(res.rentYielding).toBe(false);
    expect(res.listingType).toBe('Rent');
    expect(res.types).toContain('Flat/ Apartment');
  });

  it('should detect direct/owner listing source', () => {
    const direct = parsePropertyQuery('direct listing commercial > 10 cr');
    expect(direct.listingSource).toBe('owner');
    expect(direct.minPrice).toBe(100000001);
    expect(direct.types).toContain('Commercial');
    expect(direct.remainingSearch).toBe('');

    const noBroker = parsePropertyQuery('2 bhk flat no broker');
    expect(noBroker.listingSource).toBe('owner');
    expect(noBroker.bedrooms).toBe(2);
    expect(noBroker.remainingSearch).toBe('');

    const byOwner = parsePropertyQuery('villa for sale by owner');
    expect(byOwner.listingSource).toBe('owner');
    expect(byOwner.listingType).toBe('Sale');
    expect(byOwner.types).toContain('Villa');
  });

  it('should detect agent listing source', () => {
    const res = parsePropertyQuery('agent listings in Whitefield');
    expect(res.listingSource).toBe('agent');
    expect(res.remainingSearch).toBe('whitefield');

    const broker = parsePropertyQuery('shops through broker under 1 cr');
    expect(broker.listingSource).toBe('agent');
    expect(broker.maxPrice).toBe(10000000);
    expect(broker.types).toContain('Commercial Shop');
    expect(broker.remainingSearch).toBe('');
  });

  it('should not set listing source without a source phrase', () => {
    const res = parsePropertyQuery('villa > 3 Cr in Whitefield');
    expect(res.listingSource).toBeNull();
  });

  it('should map farm land and agriculture land phrasing to agricultural types', () => {
    const farm = parsePropertyQuery('farm lands under 2 cr');
    expect(farm.types).toEqual(['Agricultural Land', 'Farm House']);
    expect(farm.maxPrice).toBe(20000000);
    expect(farm.remainingSearch).toBe('');

    const agri = parsePropertyQuery('agriculture land in Devanahalli');
    expect(agri.types).toEqual(['Agricultural Land', 'Farm House']);
    expect(agri.remainingSearch).toBe('devanahalli');

    const agriShort = parsePropertyQuery('agri land');
    expect(agriShort.types).toEqual(['Agricultural Land', 'Farm House']);
    expect(agriShort.remainingSearch).toBe('');

    const farmland = parsePropertyQuery('farmland above 5 acres');
    expect(farmland.types).toEqual(['Agricultural Land', 'Farm House']);
    expect(farmland.minArea).toBe(5 * 43560);
    expect(farmland.remainingSearch).toBe('');
  });
});
