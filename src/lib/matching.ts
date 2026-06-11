import type { Contact, Property } from '@/types';

export interface MatchingResult {
  contact: Contact;
  score: number; // 0 to 100
  matchedFields: {
    budget: boolean;
    area: boolean;
    interest: boolean;
  };
}

/**
 * Matches a list of contacts against a given property's attributes (price, location, type, features, etc.)
 * based on the contacts' real estate preferences (budget range, areas of interest, property interests).
 */
export function getMatchingContacts(
  property: Partial<Property>,
  contacts: Contact[]
): MatchingResult[] {
  // If property lacks minimum required details to match, return empty
  if (!property.price && !property.location && !property.type) {
    return [];
  }

  const results: MatchingResult[] = [];

  for (const contact of contacts) {
    // 1. Budget Match
    let budgetMatch = false;
    const price = Number(property.price || 0);

    const minBudget = contact.min_budget ? Number(contact.min_budget) : null;
    const maxBudget = contact.max_budget ? Number(contact.max_budget) : null;
    const noBudget = !!contact.no_budget;

    if (noBudget) {
      budgetMatch = true;
    } else if (minBudget !== null || maxBudget !== null) {
      const minOk = minBudget === null || price >= minBudget;
      const maxOk = maxBudget === null || price <= maxBudget;
      budgetMatch = minOk && maxOk;
    } else {
      // Unrestricted budget preference matches by default
      budgetMatch = true;
    }

    // 2. Area Match
    let areaMatch = false;
    const areas = contact.areas_of_interest || [];
    const propLoc = (property.location || '').toLowerCase();
    const propSub = (property.sublocality || '').toLowerCase();
    const propCity = (property.city || '').toLowerCase();
    const propProject = (property.project || '').toLowerCase();

    if (
      areas.length === 0 ||
      areas.some((a) => {
        const lower = a.toLowerCase().trim();
        return lower === 'not specific' || lower === 'any' || lower === '';
      })
    ) {
      areaMatch = true;
    } else {
      // Check substring match for any area of interest
      areaMatch = areas.some((area) => {
        const cleanArea = area.toLowerCase().trim();
        if (!cleanArea) return false;
        return (
          propLoc.includes(cleanArea) ||
          propSub.includes(cleanArea) ||
          propCity.includes(cleanArea) ||
          propProject.includes(cleanArea)
        );
      });
    }

    // 3. Property Interest/Type Match
    let interestMatch = false;
    const interests = contact.property_interests || [];
    const title = (property.title || '').toLowerCase();
    const desc = (property.description || '').toLowerCase();
    const type = (property.type || '').toLowerCase();
    const features = (property.features || []).map((f) => f.toLowerCase());

    if (interests.length === 0) {
      // Default to true if contact has not specified properties preferences
      interestMatch = true;
    } else {
      // Match if any contact interest keyword is found in property fields
      interestMatch = interests.some((interest) => {
        const cleanInt = interest.toLowerCase().trim();

        if (cleanInt === 'vacant plot' || cleanInt === 'vacant land') {
          const isLand = type.includes('land') || type.includes('plot');
          const hasVacantWord =
            title.includes('vacant') ||
            desc.includes('vacant') ||
            title.includes('plot') ||
            desc.includes('plot');
          return isLand || hasVacantWord;
        }

        if (cleanInt === 'vacant building') {
          const isNotLand = !type.includes('land') && !type.includes('plot');
          const hasVacantWord =
            title.includes('vacant') ||
            desc.includes('vacant') ||
            title.includes('empty building') ||
            features.includes('vacant');
          return isNotLand && hasVacantWord;
        }

        if (cleanInt.includes('roi') || cleanInt.includes('rental') || cleanInt.includes('yield')) {
          return (
            title.includes('roi') ||
            desc.includes('roi') ||
            title.includes('rental') ||
            desc.includes('rental') ||
            title.includes('yield') ||
            desc.includes('yield') ||
            title.includes('income') ||
            desc.includes('income') ||
            title.includes('tenant') ||
            desc.includes('tenant') ||
            title.includes('rented') ||
            desc.includes('rented')
          );
        }

        if (
          cleanInt.includes('site rate') ||
          cleanInt.includes('old building') ||
          cleanInt.includes('demolish')
        ) {
          return (
            title.includes('site rate') ||
            desc.includes('site rate') ||
            title.includes('old building') ||
            desc.includes('old building') ||
            title.includes('demolish') ||
            desc.includes('demolish') ||
            title.includes('plot value') ||
            desc.includes('plot value') ||
            title.includes('land value') ||
            desc.includes('land value')
          );
        }

        // General search
        return title.includes(cleanInt) || desc.includes(cleanInt) || type.includes(cleanInt);
      });
    }

    // Contact is a match if all criteria are satisfied
    if (budgetMatch && areaMatch && interestMatch) {
      let score = 0;
      let matchedCount = 0;

      // Score components:
      // Budget: 30 pts if specific budget is defined and matches, 15 if no_budget
      if (minBudget || maxBudget) {
        score += 30;
        matchedCount++;
      } else if (noBudget) {
        score += 15;
        matchedCount++;
      }

      // Location: 35 pts if specific areas match
      const specificAreas = areas.filter(
        (a) =>
          !['not specific', 'any', ''].includes(a.toLowerCase().trim())
      );
      if (specificAreas.length > 0) {
        score += 35;
        matchedCount++;
      }

      // Interests: 35 pts if specific interests match
      if (interests.length > 0) {
        score += 35;
        matchedCount++;
      }

      // If contact is completely open (no preferences set), give a base match score of 50
      if (score === 0) score = 50;

      results.push({
        contact,
        score,
        matchedFields: {
          budget: budgetMatch && (minBudget !== null || maxBudget !== null || noBudget),
          area: areaMatch && specificAreas.length > 0,
          interest: interestMatch && interests.length > 0,
        },
      });
    }
  }

  // Sort descending by match score
  return results.sort((a, b) => b.score - a.score);
}
