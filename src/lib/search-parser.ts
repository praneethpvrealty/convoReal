export const CATEGORY_SUBTYPES: Record<string, string[]> = {
  Residential: [
    "Residential",
    "Flat/ Apartment",
    "Residential House",
    "Villa",
    "Builder Floor Apartment",
    "Residential Land/ Plot",
    "Penthouse",
    "Studio Apartment",
    "Farm House",
  ],
  Commercial: [
    "Commercial",
    "Commercial Office Space",
    "Office in IT Park/ SEZ",
    "Commercial Shop",
    "Commercial Showroom",
    "Commercial Building",
    "Commercial Land",
    "Warehouse/ Godown",
    "Industrial Land",
    "Industrial Building",
    "Industrial Shed",
  ],
  Agricultural: [
    "Agricultural",
    "Agricultural Land",
    "Farm House",
  ],
};

export interface ParsedQuery {
  minPrice: number | null;
  maxPrice: number | null;
  minArea: number | null;
  maxArea: number | null;
  bedrooms: number | null;
  types: string[];
  listingType: 'Sale' | 'Rent' | null;
  rentYielding: boolean;
  locations: string[];
  remainingSearch: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Unit helpers
// ─────────────────────────────────────────────────────────────────────────────

function parsePriceUnit(val: number, unit: string): number {
  const u = unit.toLowerCase().replace(/\s+/g, '');
  if (u.startsWith('cr'))  return val * 10_000_000;
  if (u.startsWith('l') || u === 'lac' || u === 'lacs') return val * 100_000;
  if (u.startsWith('k'))   return val * 1_000;
  return val;
}

function parseAreaUnit(val: number, unit: string): number {
  const u = unit.toLowerCase().replace(/\s+/g, '');
  if (u.includes('acre'))   return val * 43_560; // to sqft
  if (u.includes('gunta'))  return val * 1_089;
  if (u.includes('ground')) return val * 2_400;
  if (u.includes('cent'))   return val * 435.6;
  // sqm → sqft
  if (u.startsWith('sqm') || u.includes('meter') || u.includes('mtr')) return val * 10.764;
  return val; // sqft passthrough
}

// ─────────────────────────────────────────────────────────────────────────────
// Core parser
// ─────────────────────────────────────────────────────────────────────────────

export function parsePropertyQuery(searchQuery: string): ParsedQuery {
  let q = searchQuery.toLowerCase().trim();

  if (!q) {
    return { minPrice: null, maxPrice: null, minArea: null, maxArea: null,
             bedrooms: null, types: [], listingType: null, rentYielding: false,
             locations: [], remainingSearch: '' };
  }

  let minPrice: number | null = null;
  let maxPrice: number | null = null;
  let minArea: number | null = null;
  let maxArea: number | null = null;
  let bedrooms: number | null = null;
  let listingType: 'Sale' | 'Rent' | null = null;

  // ── Rent-yield intent ─────────────────────────────────────────────────────
  // "rent yielding commercial > 10 cr" is a sale of an income-producing
  // asset — consume the phrase before listing-type detection so "rent"
  // doesn't misclassify the query as a Rent listing.
  const rentYieldPattern = /\b(?:rent(?:al)?[\s-]?yield(?:ing)?|rent(?:al)?[\s-]?income|income[\s-]?(?:generating|producing|yielding)|revenue[\s-]?generating|pre[\s-]?(?:leased|rented)|tenanted|leased[\s-]?out)\b/gi;
  const rentYielding = rentYieldPattern.test(q);
  if (rentYielding) q = q.replace(rentYieldPattern, ' ');

  // ── Listing type ──────────────────────────────────────────────────────────
  if (/\bfor\s+rent\b|\bto\s+rent\b|\brent(?:al)?\b|\blease\b/i.test(q)) {
    listingType = 'Rent';
  } else if (/\bfor\s+sale\b|\bto\s+(?:buy|sell)\b|\bsale\b|\bsell\b/i.test(q)) {
    listingType = 'Sale';
  } else if (rentYielding) {
    listingType = 'Sale';
  }

  // ── Bedrooms ──────────────────────────────────────────────────────────────
  // "3 bhk", "3bhk", "3 bedroom", "3-bedroom", "3 bed"
  const bedroomMatch = q.match(/\b(\d+)\s*(?:-\s*)?(?:bhk|bedroom?s?|bed)\b/i);
  if (bedroomMatch) {
    bedrooms = parseInt(bedroomMatch[1], 10);
    q = q.replace(bedroomMatch[0], ' ');
  }

  // ── Price parsing ─────────────────────────────────────────────────────────

  // Operator style: > 20 cr, >= 50 lakhs, < 1.5 cr, <= 80L
  const opPricePattern = /([><]=?)\s*(?:rs\.?\s*|inr\s*|₹\s*)?(\d+(?:\.\d+)?)\s*(cr(?:ore)?s?|lakh?s?|lacs?|k)\b/gi;
  let opPriceMatch;
  while ((opPriceMatch = opPricePattern.exec(q)) !== null) {
    const op  = opPriceMatch[1];
    const val = parsePriceUnit(parseFloat(opPriceMatch[2]), opPriceMatch[3]);
    if (op === '>'  || op === '>=') minPrice = op === '>=' ? val : val + 1;
    if (op === '<'  || op === '<=') maxPrice = op === '<=' ? val : val - 1;
    q = q.replace(opPriceMatch[0], ' ');
  }

  if (minPrice === null && maxPrice === null) {
    // Range: "50L to 1 cr", "between 1 cr and 2 cr", "1-2 cr"
    const rangeBoth = /(?:between\s+)?(\d+(?:\.\d+)?)\s*(cr(?:ore)?s?|lakh?s?|lacs?|k)\s*(?:to|and|-)\s*(\d+(?:\.\d+)?)\s*(cr(?:ore)?s?|lakh?s?|lacs?|k)/gi;
    const rangeSingle = /(?:between\s+)?(\d+(?:\.\d+)?)\s*(?:to|and|-)\s*(\d+(?:\.\d+)?)\s*(cr(?:ore)?s?|lakh?s?|lacs?|k)/gi;

    let m = rangeBoth.exec(q);
    if (m) {
      minPrice = parsePriceUnit(parseFloat(m[1]), m[2]);
      maxPrice = parsePriceUnit(parseFloat(m[3]), m[4]);
      q = q.replace(m[0], ' ');
    } else {
      m = rangeSingle.exec(q);
      if (m) {
        minPrice = parsePriceUnit(parseFloat(m[1]), m[3]);
        maxPrice = parsePriceUnit(parseFloat(m[2]), m[3]);
        q = q.replace(m[0], ' ');
      }
    }

    if (minPrice === null && maxPrice === null) {
      // Natural language bounds
      const maxKeyword = /(?:under|below|less\s+than|max(?:imum)?|upto?|up\s+to|within)\s+(?:rs\.?\s*|inr\s*|₹\s*)?(\d+(?:\.\d+)?)\s*(cr(?:ore)?s?|lakh?s?|lacs?|k)/gi;
      const minKeyword = /(?:above|more\s+than|greater\s+than|min(?:imum)?|starting\s+(?:from|at)|at\s+least|from)\s+(?:rs\.?\s*|inr\s*|₹\s*)?(\d+(?:\.\d+)?)\s*(cr(?:ore)?s?|lakh?s?|lacs?|k)/gi;
      const approxKeyword = /(?:around|about|approx(?:imate(?:ly)?)?|~)?\s*(?:rs\.?\s*|inr\s*|₹\s*)?(\d+(?:\.\d+)?)\s*(cr(?:ore)?s?|lakh?s?|lacs?|k)\b/gi;

      let mm = maxKeyword.exec(q);
      if (mm) { maxPrice = parsePriceUnit(parseFloat(mm[1]), mm[2]); q = q.replace(mm[0], ' '); }

      maxKeyword.lastIndex = 0;
      mm = minKeyword.exec(q);
      if (mm) { minPrice = parsePriceUnit(parseFloat(mm[1]), mm[2]); q = q.replace(mm[0], ' '); }

      if (minPrice === null && maxPrice === null) {
        approxKeyword.lastIndex = 0;
        mm = approxKeyword.exec(q);
        if (mm) {
          const target = parsePriceUnit(parseFloat(mm[1]), mm[2]);
          minPrice = target * 0.85;
          maxPrice = target * 1.15;
          q = q.replace(mm[0], ' ');
        }
      }
    }
  }

  // ── Area parsing ──────────────────────────────────────────────────────────

  // "> 2000 sqft", "< 1 acre"
  const opAreaPattern = /([><]=?)\s*(\d+(?:\.\d+)?)\s*(sq\.?\s*(?:ft|feet|meter|mtr|m)|sqft|sqm|acres?|guntas?|grounds?|cents?)\b/gi;
  let opAreaMatch;
  while ((opAreaMatch = opAreaPattern.exec(q)) !== null) {
    const op  = opAreaMatch[1];
    const val = parseAreaUnit(parseFloat(opAreaMatch[2]), opAreaMatch[3]);
    if (op === '>'  || op === '>=') minArea = op === '>=' ? val : val + 1;
    if (op === '<'  || op === '<=') maxArea = op === '<=' ? val : val - 1;
    q = q.replace(opAreaMatch[0], ' ');
  }

  if (minArea === null && maxArea === null) {
    const areaRange = /(\d+(?:\.\d+)?)\s*(?:to|-)\s*(\d+(?:\.\d+)?)\s*(sq\.?\s*(?:ft|feet|meter|mtr|m)|sqft|sqm|acres?|guntas?|grounds?|cents?)\b/gi;
    const am = areaRange.exec(q);
    if (am) {
      minArea = parseAreaUnit(parseFloat(am[1]), am[3]);
      maxArea = parseAreaUnit(parseFloat(am[2]), am[3]);
      q = q.replace(am[0], ' ');
    }
  }

  if (minArea === null && maxArea === null) {
    // Natural language bounds, mirroring the price keywords above:
    // "above 30000 sqft", "under 2 acres", "at least 5 guntas"
    const areaUnit = '(sq\\.?\\s*(?:ft|feet|meter|mtr|m)|sqft|sqm|acres?|guntas?|grounds?|cents?)';
    const maxAreaKeyword = new RegExp(
      `(?:under|below|less\\s+than|max(?:imum)?|upto?|up\\s+to|within)\\s+(\\d+(?:\\.\\d+)?)\\s*${areaUnit}\\b`, 'gi');
    const minAreaKeyword = new RegExp(
      `(?:above|over|more\\s+than|greater\\s+than|min(?:imum)?|at\\s+least|starting\\s+(?:from|at)|from)\\s+(\\d+(?:\\.\\d+)?)\\s*${areaUnit}\\b`, 'gi');

    let am = maxAreaKeyword.exec(q);
    if (am) { maxArea = parseAreaUnit(parseFloat(am[1]), am[2]); q = q.replace(am[0], ' '); }

    am = minAreaKeyword.exec(q);
    if (am) { minArea = parseAreaUnit(parseFloat(am[1]), am[2]); q = q.replace(am[0], ' '); }
  }

  // ── Property type detection ───────────────────────────────────────────────

  const types: string[] = [];

  const TYPE_RULES: Array<{ pattern: RegExp; types: string[] }> = [
    { pattern: /\bresidential\s+(?:land|plot)s?\b/i,        types: ['Residential Land/ Plot'] },
    { pattern: /\bcommercial\s+(?:land|plot)s?\b/i,         types: ['Commercial Land'] },
    { pattern: /\bindustrial\s+(?:land|plot)s?\b/i,         types: ['Industrial Land'] },
    { pattern: /\bagricultural\s+(?:land|plot|farm)s?\b|\bfarm\s+land\b/i, types: ['Agricultural Land', 'Farm House'] },
    { pattern: /\bplots?\b|\bland\b|\blands\b/i,            types: ['Residential Land/ Plot','Commercial Land','Industrial Land','Agricultural Land'] },
    { pattern: /\bvillas?\b/i,                               types: ['Villa'] },
    { pattern: /\bpenthouse[s]?\b/i,                         types: ['Penthouse'] },
    { pattern: /\bstudio\b/i,                                types: ['Studio Apartment'] },
    { pattern: /\bbuilder\s+floor\b/i,                       types: ['Builder Floor Apartment'] },
    { pattern: /\b(?:flat|flats|apartment|apartments)\b/i,  types: ['Flat/ Apartment','Builder Floor Apartment','Studio Apartment','Penthouse'] },
    { pattern: /\b(?:row\s+house|independent\s+house|residential\s+house)\b/i, types: ['Residential House'] },
    { pattern: /\bhouse[s]?\b/i,                             types: ['Residential House','Villa','Farm House'] },
    { pattern: /\bfarm\s*house[s]?\b/i,                      types: ['Farm House'] },
    { pattern: /\boffice\s+(?:space|park|it\s+park)\b|\bit\s+park\b|\bsez\b/i, types: ['Office in IT Park/ SEZ','Commercial Office Space'] },
    { pattern: /\boffices?\b/i,                              types: ['Commercial Office Space','Office in IT Park/ SEZ'] },
    { pattern: /\bshowrooms?\b|\bretail\s+space\b/i,         types: ['Commercial Showroom'] },
    { pattern: /\bshops?\b/i,                                types: ['Commercial Shop','Commercial Showroom'] },
    { pattern: /\bwarehouse[s]?\b|\bgodowns?\b/i,            types: ['Warehouse/ Godown'] },
    { pattern: /\bindustrial\s+(?:shed|building)s?\b/i,      types: ['Industrial Building','Industrial Shed'] },
    { pattern: /\bmixed[\s-]*use\b|\bcommercial\s+(?:building|complex|development)s?\b/i, types: ['Commercial Building'] },
    { pattern: /\bcommercial\b/i,                            types: ['Commercial','Commercial Office Space','Office in IT Park/ SEZ','Commercial Shop','Commercial Showroom','Commercial Building','Commercial Land','Warehouse/ Godown','Industrial Land','Industrial Building','Industrial Shed'] },
    { pattern: /\bresidential\b/i,                           types: ['Residential','Flat/ Apartment','Residential House','Villa','Builder Floor Apartment','Residential Land/ Plot','Penthouse','Studio Apartment'] },
    { pattern: /\bagricultural\b/i,                          types: ['Agricultural','Agricultural Land','Farm House'] },
  ];

  for (const rule of TYPE_RULES) {
    if (rule.pattern.test(q)) {
      rule.types.forEach(t => { if (!types.includes(t)) types.push(t); });
      // Only break for specific matches, not broad categories
      if (!['Commercial','Residential','Agricultural'].some(c => rule.types.includes(c))) {
        break;
      }
    }
  }

  // ── Location extraction ───────────────────────────────────────────────────
  // "in Whitefield", "in Domlur Bengaluru", "at Koramangala", "near Marathahalli"
  const locations: string[] = [];
  const locPattern = /\b(?:in|at|near|around|from)\s+([A-Z][a-zA-Z\s]{2,30?}?)(?=\s+(?:with|for|under|above|below|price|area|bhk|\d)|$|,|\.|$)/gi;
  let locMatch;
  while ((locMatch = locPattern.exec(searchQuery)) !== null) {
    const loc = locMatch[1].trim().replace(/\s+/g, ' ');
    if (loc.length >= 3) locations.push(loc);
    q = q.replace(locMatch[0].toLowerCase(), ' ');
  }

  // ── Build remaining search string ─────────────────────────────────────────

  let remaining = q;

  // Strip price/area expressions already consumed
  remaining = remaining.replace(/[><]=?\s*\d+(?:\.\d+)?\s*(?:cr(?:ore)?s?|lakh?s?|lacs?|k|sq\.?\s*(?:ft|feet|meter|mtr|m)|sqft|sqm|acres?|guntas?|grounds?|cents?)?/gi, '');
  remaining = remaining.replace(/\d+(?:\.\d+)?\s*(?:cr(?:ore)?s?|lakh?s?|lacs?|k)\b/gi, '');
  remaining = remaining.replace(/\d+(?:\.\d+)?\s*(?:sq\.?\s*(?:ft|feet|meter|mtr|m)|sqft|sqm|acres?|guntas?|grounds?|cents?)\b/gi, '');

  // Strip listing type words
  remaining = remaining.replace(/\bfor\s+(?:sale|rent)\b|\bto\s+(?:rent|buy|sell)\b|\b(?:sale|rent(?:al)?|lease)\b/gi, '');

  // Strip type keywords
  const TYPE_KEYWORDS = [
    'residential plots','residential plot','commercial land','commercial plot',
    'industrial land','industrial plot','agricultural land','agricultural plot',
    'farm land','farm house','farmhouse','builder floor',
    'penthouse','penthouses','studio','plot','plots','land','lands',
    'villa','villas','house','houses','independent house','row house',
    'flat','flats','apartment','apartments',
    'office space','office','offices','it park','sez',
    'shop','shops','showroom','showrooms','retail space','retail',
    'warehouse','warehouses','godown','godowns',
    'commercial building','commercial complex','commercial development',
    'mixed use','mixed-use',
    'industrial building','industrial shed',
    'commercial','residential','agricultural',
  ];
  TYPE_KEYWORDS.sort((a, b) => b.length - a.length); // longest first
  TYPE_KEYWORDS.forEach(kw => {
    remaining = remaining.replace(new RegExp(`\\b${kw.replace(/\//g,'\\/')}\\b`, 'gi'), '');
  });

  // Strip bedroom words
  remaining = remaining.replace(/\b\d+\s*(?:-\s*)?(?:bhk|bedrooms?|bed)\b/gi, '');

  // Strip filler words. 'vacant'/'empty'/'open' are land adjectives that
  // carry no filterable meaning ("vacant land" IS land) — left in place
  // they'd AND a text match that no listing contains and zero the results.
  const FILLERS = ['properties','property','listing','listings','with','having',
    'price','cost','budget','rate','value','area','size','sqft','sq ft',
    'from','to','range','between','and','in','at','for','near','around','about',
    'approx','under','above','below','over','more','less','than','the','a','an',
    'all','any','some','give','show','find','search','get','list','want',
    'vacant','empty','open','yield','yielding'];
  FILLERS.sort((a, b) => b.length - a.length);
  FILLERS.forEach(f => {
    remaining = remaining.replace(new RegExp(`\\b${f}\\b`, 'gi'), '');
  });

  remaining = remaining.replace(/\s+/g, ' ').trim();

  return {
    minPrice,
    maxPrice,
    minArea,
    maxArea,
    bedrooms,
    types,
    listingType,
    rentYielding,
    locations,
    remainingSearch: remaining,
  };
}
