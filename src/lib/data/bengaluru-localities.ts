import { POPULAR_SUBLOCALITIES } from './real-estate-data';

interface LocalityTemplate {
  name: string;
  type: 'sector' | 'block' | 'phase' | 'stage';
  count: number;
  mains: string[];
  crosses: string[];
}

const templates: LocalityTemplate[] = [
  {
    name: 'HSR Layout',
    type: 'sector',
    count: 7,
    mains: ['27th Main Road', '19th Main Road', '14th Main Road', '5th Main Road', '17th Cross Road', '22nd Cross Road'],
    crosses: ['1st Cross', '2nd Cross', '3rd Cross', '4th Cross', '5th Cross', '12th Cross', '19th Cross']
  },
  {
    name: 'Koramangala',
    type: 'block',
    count: 8,
    mains: ['80 Feet Road', '100 Feet Road', '1st Main Road', '4th Main Road', 'Intermediate Ring Road'],
    crosses: ['1st Cross', '2nd Cross', '3rd Cross', '5th Cross', '8th Cross', '12th Cross']
  },
  {
    name: 'Jayanagar',
    type: 'block',
    count: 9,
    mains: ['Rashtreeya Vidyalaya Road', '11th Main Road', '9th Main Road', '30th Cross Road'],
    crosses: ['1st Cross', '2nd Cross', '4th Cross', '8th Cross', '12th Cross']
  },
  {
    name: 'JP Nagar',
    type: 'phase',
    count: 9,
    mains: ['24th Main Road', '15th Cross Road', 'Kanakapura Road', 'Outer Ring Road'],
    crosses: ['1st Cross', '2nd Cross', '5th Cross', '10th Cross', '14th Cross']
  },
  {
    name: 'BTM Layout',
    type: 'stage',
    count: 2,
    mains: ['Outer Ring Road', '16th Main Road', '29th Main Road', '7th Cross Road'],
    crosses: ['1st Cross', '2nd Cross', '5th Cross', '10th Cross']
  },
  {
    name: 'Indiranagar',
    type: 'stage',
    count: 2,
    mains: ['100 Feet Road', '80 Feet Road', 'Double Road', 'CMH Road', '12th Main Road', '17th Main Road'],
    crosses: ['1st Cross', '2nd Cross', '5th Cross', '9th Cross']
  },
  {
    name: 'HRBR Layout',
    type: 'block',
    count: 3,
    mains: ['80 Feet Road', 'Kammanahalli Main Road', 'Outer Ring Road'],
    crosses: ['1st Cross', '2nd Cross', '3rd Cross', '5th Cross']
  },
  {
    name: 'Banashankari',
    type: 'stage',
    count: 6,
    mains: ['Outer Ring Road', 'Katriguppe Main Road', 'Kathriguppe 80 Feet Road'],
    crosses: ['1st Cross', '2nd Cross', '4th Cross', '10th Cross']
  },
  {
    name: 'Rajajinagar',
    type: 'block',
    count: 6,
    mains: ['Dr. Rajkumar Road', 'Chord Road', '10th Main Road'],
    crosses: ['1st Cross', '2nd Cross', '5th Cross', '8th Cross']
  }
];

const standardLocalities = [
  {
    name: 'Whitefield',
    subareas: ['ITPL', 'ECC Road', 'Hope Farm', 'Kadugodi', 'Nallurhalli', 'Hagadur', 'Borewell Road'],
    mains: ['ITPL Main Road', 'Whitefield Main Road', 'Borewell Road', 'Channasandra Main Road'],
    crosses: ['1st Cross', '2nd Cross', '3rd Cross']
  },
  {
    name: 'Bellandur',
    subareas: ['Green Glen Layout', 'Kasavanahalli', 'Haralur Road', 'Ibblur'],
    mains: ['Outer Ring Road', 'Haralur Main Road', 'Kasavanahalli Main Road'],
    crosses: ['1st Cross', '2nd Cross', '3rd Cross', '4th Cross']
  },
  {
    name: 'Marathahalli',
    subareas: ['Munnekollal', 'Sanjay Nagar', 'Ashwath Nagar', 'Spice Garden'],
    mains: ['Outer Ring Road', 'Kundalahalli Main Road', 'Varthur Road'],
    crosses: ['1st Cross', '2nd Cross', '3rd Cross']
  },
  {
    name: 'Hebbal',
    subareas: ['Kempapura', 'RT Nagar', 'Ganganagar', 'Nagavara'],
    mains: ['Bellary Road', 'Outer Ring Road', 'Kempapura Main Road'],
    crosses: ['1st Cross', '2nd Cross', '3rd Cross']
  },
  {
    name: 'Malleshwaram',
    subareas: ['Sampige Road', 'Margosa Road'],
    mains: ['Sampige Road', 'Margosa Road', '15th Cross Road', 'Dr. Rajkumar Road'],
    crosses: ['1st Cross', '2nd Cross', '3rd Cross']
  },
  {
    name: 'Electronic City',
    subareas: ['Phase 1', 'Phase 2'],
    mains: ['Hosur Road', 'Neeladri Road', 'Bettadasanapura Road'],
    crosses: ['1st Cross', '2nd Cross', '3rd Cross']
  },
  {
    name: 'Yelahanka',
    subareas: ['Yelahanka New Town', 'Yelahanka Old Town'],
    mains: ['Doddaballapur Road', 'Major Sandeep Unnikrishnan Road'],
    crosses: ['1st Cross', '2nd Cross', '3rd Cross']
  },
  {
    name: 'Basavanagudi',
    subareas: ['Gandhi Bazaar', 'DVG Road', 'Bull Temple Road'],
    mains: ['DVG Road', 'Bull Temple Road', 'KR Road'],
    crosses: ['1st Cross', '2nd Cross']
  },
  {
    name: 'Sadashivanagar',
    subareas: ['Ramanashree Road', 'Armane Nagar'],
    mains: ['Bellary Road', 'Ramanashree Road'],
    crosses: ['1st Cross', '2nd Cross']
  },
  {
    name: 'Kalyan Nagar',
    subareas: ['HRBR Layout', 'Babusapalya'],
    mains: ['Kammanahalli Main Road', '80 Feet Road', 'Outer Ring Road'],
    crosses: ['1st Cross', '2nd Cross', '3rd Cross']
  }
];

let cachedDetailed: string[] = [];
let cachedMajor: string[] = [];

function getOrdinalSuffix(i: number): string {
  if (i === 1) return '1st';
  if (i === 2) return '2nd';
  if (i === 3) return '3rd';
  return `${i}th`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function getMajorAreas(): string[] {
  if (cachedMajor.length > 0) return cachedMajor;

  const set = new Set<string>();

  // Add the base sublocalities
  POPULAR_SUBLOCALITIES.forEach(a => set.add(a));

  // Expand templates
  for (const t of templates) {
    set.add(t.name);
    for (let i = 1; i <= t.count; i++) {
      const suffix = getOrdinalSuffix(i);
      set.add(`${t.name} ${suffix} ${capitalize(t.type)}`);
    }
  }

  // Expand standard ones
  for (const s of standardLocalities) {
    set.add(s.name);
    for (const sub of s.subareas) {
      set.add(`${s.name} ${sub}`);
    }
  }

  cachedMajor = Array.from(set).sort();
  return cachedMajor;
}

export function getDetailedLocalities(): string[] {
  if (cachedDetailed.length > 0) return cachedDetailed;

  const set = new Set<string>();

  const addPermutations = (base: string, mains: string[], crosses: string[]) => {
    set.add(base);
    for (const main of mains) {
      set.add(`${base}, ${main}`);
      for (const cross of crosses) {
        set.add(`${base}, ${main}, ${cross}`);
      }
    }
    for (const cross of crosses) {
      set.add(`${base}, ${cross}`);
    }
  };

  // Expand templates
  for (const t of templates) {
    set.add(t.name);
    for (const main of t.mains) {
      set.add(`${t.name}, ${main}`);
      for (const cross of t.crosses) {
        set.add(`${t.name}, ${main}, ${cross}`);
      }
    }

    for (let i = 1; i <= t.count; i++) {
      const suffix = getOrdinalSuffix(i);
      const sectorName = `${t.name} ${suffix} ${capitalize(t.type)}`;
      addPermutations(sectorName, t.mains, t.crosses);
    }
  }

  // Expand standard localities
  for (const s of standardLocalities) {
    addPermutations(s.name, s.mains, s.crosses);
    for (const sub of s.subareas) {
      const subareaName = `${s.name} ${sub}`;
      addPermutations(subareaName, s.mains, s.crosses);
    }
  }

  // Fallback to basic POPULAR_SUBLOCALITIES
  POPULAR_SUBLOCALITIES.forEach(a => set.add(a));

  cachedDetailed = Array.from(set).sort();
  return cachedDetailed;
}
