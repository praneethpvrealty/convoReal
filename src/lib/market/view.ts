export interface MarketSupplyCell {
  period_month: string;
  city: string;
  locality: string;
  property_type: string;
  listing_type: string;
  listings_count: number | null;
  median_price: number | null;
  median_area_sqft: number | null;
  sold_count: number | null;
  median_sold_price: number | null;
  median_days_to_sell: number | null;
  accounts_count: number;
}

export interface MarketDemandCell {
  period_month: string;
  locality: string;
  property_type: string;
  buyer_count: number | null;
  median_budget: number | null;
  accounts_count: number;
}

export interface OwnLocalityMedian {
  city: string;
  locality: string;
  property_type: string;
  listing_type: string;
  listings_count: number;
  median_price: number | null;
  median_area_sqft: number | null;
}

export interface MarketStatsResponse {
  consent: boolean;
  isOwner: boolean;
  supply: MarketSupplyCell[];
  demand: MarketDemandCell[];
  own: OwnLocalityMedian[];
}

export interface LocalityRow {
  key: string;
  locality: string;
  propertyType: string;
  listingType: string;
  listings: number;
  medianPrice: number | null;
  medianAreaSqft: number | null;
  sold: number;
  medianDaysToSell: number | null;
  buyers: number;
  medianBudget: number | null;
  yourListings: number;
  yourMedianPrice: number | null;
  priceDeltaPct: number | null;
}

export function titleCaseToken(token: string): string {
  return token
    .split(' ')
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ');
}

export function marketMonths(supply: MarketSupplyCell[]): string[] {
  return Array.from(new Set(supply.map((c) => c.period_month))).sort();
}

export function cityOptions(supply: MarketSupplyCell[]): string[] {
  return Array.from(new Set(supply.map((c) => c.city))).sort();
}

export function pctDelta(yours: number, market: number): number | null {
  if (!market) return null;
  return ((yours - market) / market) * 100;
}

function cellKey(
  locality: string,
  propertyType: string,
  listingType: string
): string {
  return `${locality}|${propertyType}|${listingType}`;
}

export function buildLocalityRows(
  data: Pick<MarketStatsResponse, 'supply' | 'demand' | 'own'>,
  city: string,
  month: string
): LocalityRow[] {
  const demandLatest = new Map<string, MarketDemandCell>();
  for (const cell of data.demand) {
    const key = `${cell.locality}|${cell.property_type}`;
    const existing = demandLatest.get(key);
    if (!existing || cell.period_month > existing.period_month) {
      demandLatest.set(key, cell);
    }
  }

  const ownByKey = new Map<string, OwnLocalityMedian>();
  for (const own of data.own) {
    if (own.city !== city) continue;
    ownByKey.set(
      cellKey(own.locality, own.property_type, own.listing_type),
      own
    );
  }

  return data.supply
    .filter((c) => c.city === city && c.period_month === month)
    .map((cell) => {
      const demand =
        demandLatest.get(`${cell.locality}|${cell.property_type}`) ??
        demandLatest.get(`${cell.locality}|any`);
      const own = ownByKey.get(
        cellKey(cell.locality, cell.property_type, cell.listing_type)
      );
      const yourMedianPrice = own?.median_price ?? null;
      return {
        key: cellKey(cell.locality, cell.property_type, cell.listing_type),
        locality: cell.locality,
        propertyType: cell.property_type,
        listingType: cell.listing_type,
        listings: cell.listings_count ?? 0,
        medianPrice: cell.median_price,
        medianAreaSqft: cell.median_area_sqft,
        sold: cell.sold_count ?? 0,
        medianDaysToSell: cell.median_days_to_sell,
        buyers: demand?.buyer_count ?? 0,
        medianBudget: demand?.median_budget ?? null,
        yourListings: own?.listings_count ?? 0,
        yourMedianPrice,
        priceDeltaPct:
          yourMedianPrice != null && cell.median_price != null
            ? pctDelta(yourMedianPrice, cell.median_price)
            : null,
      };
    })
    .sort(
      (a, b) => b.listings - a.listings || a.locality.localeCompare(b.locality)
    );
}

export interface TrendPoint {
  month: string;
  medianPrice: number | null;
  listings: number;
}

export function priceTrend(
  supply: MarketSupplyCell[],
  city: string,
  rowKey: string
): TrendPoint[] {
  return supply
    .filter(
      (c) =>
        c.city === city &&
        cellKey(c.locality, c.property_type, c.listing_type) === rowKey
    )
    .sort((a, b) => a.period_month.localeCompare(b.period_month))
    .map((c) => ({
      month: c.period_month,
      medianPrice: c.median_price,
      listings: c.listings_count ?? 0,
    }));
}
