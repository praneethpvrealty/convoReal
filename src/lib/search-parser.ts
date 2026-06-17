export interface ParsedQuery {
  minPrice: number | null;
  maxPrice: number | null;
  types: string[];
  remainingSearch: string;
}

export function parsePropertyQuery(searchQuery: string): ParsedQuery {
  const q = searchQuery.toLowerCase().trim();
  if (!q) {
    return { minPrice: null, maxPrice: null, types: [], remainingSearch: '' };
  }

  let minPrice: number | null = null;
  let maxPrice: number | null = null;

  const parseValWithUnit = (valStr: string, unitStr: string): number | null => {
    const val = parseFloat(valStr);
    if (isNaN(val)) return null;
    const unit = unitStr.toLowerCase();
    if (unit.startsWith('cr') || unit.startsWith('crore')) {
      return val * 10000000;
    }
    if (unit.startsWith('l') || unit.startsWith('lac') || unit.startsWith('lakh')) {
      return val * 100000;
    }
    if (unit.startsWith('k')) {
      return val * 1000;
    }
    return val;
  };

  const rangeBothUnits = /(?:between\s+)?(\d+(?:\.\d+)?)\s*(cr|crore|crores|l|lakh|lakhs|lacs|lac|k)\s*(?:to|and|-)\s*(\d+(?:\.\d+)?)\s*(cr|crore|crores|l|lakh|lakhs|lacs|lac|k)/i;
  const rangeSingleUnit = /(?:between\s+)?(\d+(?:\.\d+)?)\s*(?:to|and|-)\s*(\d+(?:\.\d+)?)\s*(cr|crore|crores|l|lakh|lakhs|lacs|lac|k)/i;

  const mBoth = q.match(rangeBothUnits);
  const mSingle = q.match(rangeSingleUnit);

  if (mBoth) {
    minPrice = parseValWithUnit(mBoth[1], mBoth[2]);
    maxPrice = parseValWithUnit(mBoth[3], mBoth[4]);
  } else if (mSingle) {
    minPrice = parseValWithUnit(mSingle[1], mSingle[3]);
    maxPrice = parseValWithUnit(mSingle[2], mSingle[3]);
  } else {
    const maxPattern = /(?:under|below|less\s+than|max|upto|up\s+to)\s*(\d+(?:\.\d+)?)\s*(cr|crore|crores|l|lakh|lakhs|lacs|lac|k)/i;
    const minPattern = /(?:above|more\s+than|greater\s+than|min|starting\s+from|starting|at\s+least)\s*(\d+(?:\.\d+)?)\s*(cr|crore|crores|l|lakh|lakhs|lacs|lac|k)/i;
    const singlePattern = /(?:around|about|approx|approximate)?\s*(\d+(?:\.\d+)?)\s*(cr|crore|crores|l|lakh|lakhs|lacs|lac|k)/i;

    const mMax = q.match(maxPattern);
    const mMin = q.match(minPattern);
    const mSingleVal = q.match(singlePattern);

    if (mMax) {
      maxPrice = parseValWithUnit(mMax[1], mMax[2]);
    } else if (mMin) {
      minPrice = parseValWithUnit(mMin[1], mMin[2]);
    } else if (mSingleVal) {
      const target = parseValWithUnit(mSingleVal[1], mSingleVal[2]);
      if (target !== null) {
        minPrice = target * 0.85;
        maxPrice = target * 1.15;
      }
    }
  }

  const types: string[] = [];
  if (q.includes('residential land') || q.includes('residential plot') || q.includes('residential plots')) {
    types.push('Residential Land/ Plot');
  } else if (q.includes('commercial land') || q.includes('commercial plot') || q.includes('commercial plots')) {
    types.push('Commercial Land');
  } else if (q.includes('industrial land') || q.includes('industrial plot')) {
    types.push('Industrial Land');
  } else if (q.includes('agricultural land') || q.includes('agricultural plot') || q.includes('farm land')) {
    types.push('Agricultural Land');
  } else if (q.includes('plot') || q.includes('plots') || q.includes('land') || q.includes('lands')) {
    types.push('Residential Land/ Plot', 'Commercial Land', 'Industrial Land', 'Agricultural Land');
  }

  if (q.includes('villa') || q.includes('villas')) {
    types.push('Villa');
  }
  if (q.includes('house') || q.includes('houses') || q.includes('independent house') || q.includes('row house')) {
    types.push('Residential House', 'Villa', 'Farm House');
  }
  if (q.includes('flat') || q.includes('flats') || q.includes('apartment') || q.includes('apartments')) {
    types.push('Flat/ Apartment', 'Builder Floor Apartment', 'Studio Apartment', 'Penthouse');
  }
  if (q.includes('penthouse') || q.includes('penthouses')) {
    types.push('Penthouse');
  }
  if (q.includes('studio')) {
    types.push('Studio Apartment');
  }
  if (q.includes('office') || q.includes('offices') || q.includes('office space')) {
    types.push('Commercial Office Space', 'Office in IT Park/ SEZ');
  }
  if (q.includes('shop') || q.includes('shops') || q.includes('showroom') || q.includes('showrooms') || q.includes('retail')) {
    types.push('Commercial Shop', 'Commercial Showroom');
  }
  if (q.includes('warehouse') || q.includes('warehouses') || q.includes('godown') || q.includes('godowns')) {
    types.push('Warehouse/ Godown');
  }
  if (q.includes('industrial building') || q.includes('industrial shed')) {
    types.push('Industrial Building', 'Industrial Shed');
  }

  if (types.length === 0) {
    if (q.includes('commercial')) {
      types.push(
        'Commercial Office Space',
        'Office in IT Park/ SEZ',
        'Commercial Shop',
        'Commercial Showroom',
        'Commercial Land',
        'Warehouse/ Godown'
      );
    }
    if (q.includes('residential')) {
      types.push(
        'Flat/ Apartment',
        'Residential House',
        'Villa',
        'Builder Floor Apartment',
        'Residential Land/ Plot',
        'Penthouse',
        'Studio Apartment'
      );
    }
    if (q.includes('agricultural')) {
      types.push('Agricultural Land', 'Farm House');
    }
  }

  let remainingSearch = q;
  remainingSearch = remainingSearch.replace(/(?:between\s+)?\d+(?:\.\d+)?\s*(?:cr|crore|crores|l|lakh|lakhs|lacs|lac|k)?\s*(?:to|and|-)\s*\d+(?:\.\d+)?\s*(?:cr|crore|crores|l|lakh|lakhs|lacs|lac|k)/gi, '');
  remainingSearch = remainingSearch.replace(/(?:under|below|less\s+than|max|upto|up\s+to|above|more\s+than|greater\s+than|min|starting\s+from|starting|at\s+least)\s*\d+(?:\.\d+)?\s*(?:cr|crore|crores|l|lakh|lakhs|lacs|lac|k)/gi, '');
  remainingSearch = remainingSearch.replace(/\b\d+(?:\.\d+)?\s*(?:cr|crore|crores|l|lakh|lakhs|lacs|lac|k)\b/gi, '');

  const typeKeywords = [
    'residential plots', 'residential plot', 'commercial land', 'commercial plot',
    'industrial land', 'industrial plot', 'agricultural land', 'agricultural plot',
    'farm land', 'plot', 'plots', 'land', 'lands', 'villa', 'villas', 'house', 'houses',
    'flat', 'flats', 'apartment', 'apartments', 'penthouse', 'penthouses', 'studio',
    'office space', 'office', 'offices', 'shop', 'shops', 'showroom', 'showrooms', 'retail',
    'warehouse', 'warehouses', 'godown', 'godowns', 'industrial building', 'industrial shed',
    'commercial', 'residential', 'agricultural', 'farm house', 'farmhouse'
  ];

  typeKeywords.forEach(kw => {
    const regex = new RegExp(`\\b${kw}\\b`, 'gi');
    remainingSearch = remainingSearch.replace(regex, '');
  });

  const fillers = ['from', 'to', 'range', 'between', 'and', 'in', 'at', 'for', 'with', 'under', 'above', 'around', 'about'];
  fillers.forEach(f => {
    const regex = new RegExp(`\\b${f}\\b`, 'gi');
    remainingSearch = remainingSearch.replace(regex, '');
  });

  remainingSearch = remainingSearch.replace(/\s+/g, ' ').trim();

  return {
    minPrice,
    maxPrice,
    types,
    remainingSearch
  };
}
