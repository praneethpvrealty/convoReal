import type { Contact, Property } from '@/types';

export interface MatchingResult {
  contact: Contact;
  score: number; // 0 to 100
  matchedFields: {
    budget: boolean;
    area: boolean;
    interest: boolean;
    roi?: boolean;
  };
}

/**
 * Helper to check if a keyword in a string is negated by a preceding negation term (e.g. "not Jayanagar", "no commercial").
 */
function isNegated(text: string, keyword: string): boolean {
  const cleanKeyword = keyword.toLowerCase().trim();
  let index = text.indexOf(cleanKeyword);
  if (index === -1) return false;
  
  while (index !== -1) {
    // Look back up to 35 characters for negation terms
    const precedingText = text.substring(Math.max(0, index - 35), index).trim();
    const negationWords = ['not', 'no', 'except', 'excluding', 'exclude', 'avoid', 'dont', "don't", 'never', 'outside', 'but'];
    
    const negated = negationWords.some(neg => {
      const regex = new RegExp(`\\b${neg}\\b`, 'i');
      return regex.test(precedingText);
    });
    
    if (negated) return true;
    
    index = text.indexOf(cleanKeyword, index + 1);
  }
  return false;
}

/**
 * Extracts min and max budget bounds from unstructured requirements/notes text.
 */
function parseBudgetFromText(text: string): { min: number | null; max: number | null } {
  const clean = text.toLowerCase();
  let maxBudgetVal: number | null = null;
  let minBudgetVal: number | null = null;

  // Max budget pattern: "under 5 Cr", "below 10 Crore", "budget 80 lakhs", "budget around 2 cr", "up to 3 crore"
  const maxPattern = /(?:under|below|up\s*to|max|maximum|budget\s+of|budget\s+around|budget\s+is)\s*(?:of\s+)?(\d+(?:\.\d+)?)\s*(cr|crore|lakh|lakhs|l|cr\.)/g;
  let match;
  while ((match = maxPattern.exec(clean)) !== null) {
    const value = parseFloat(match[1]);
    const unit = match[2];
    let multiplier = 1;
    if (unit.startsWith('cr')) {
      multiplier = 10000000;
    } else if (unit.startsWith('lakh') || unit === 'l') {
      multiplier = 100000;
    }
    maxBudgetVal = value * multiplier;
  }

  // Min budget pattern: "above 1 Cr", "at least 50 Lakhs", "min 2 cr", "minimum 3 crore"
  const minPattern = /(?:above|at\s*least|min|minimum)\s*(?:of\s+)?(\d+(?:\.\d+)?)\s*(cr|crore|lakh|lakhs|l|cr\.)/g;
  while ((match = minPattern.exec(clean)) !== null) {
    const value = parseFloat(match[1]);
    const unit = match[2];
    let multiplier = 1;
    if (unit.startsWith('cr')) {
      multiplier = 10000000;
    } else if (unit.startsWith('lakh') || unit === 'l') {
      multiplier = 100000;
    }
    minBudgetVal = value * multiplier;
  }

  return { min: minBudgetVal, max: maxBudgetVal };
}

/**
 * Matches a list of contacts against a given property's attributes (price, location, type, features, etc.)
 * based on the contacts' real estate preferences and notes.
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
    // 0. Requirements & Notes text parsing
    const notesText = (contact.contact_notes || []).map((n) => n.note_text).join(' ');
    const requirementsText = contact.requirements || '';
    const combinedText = (requirementsText + ' ' + notesText).toLowerCase();

    // Heuristically infer category interests from notes text
    const hasTypeMentions = 
      combinedText.includes('commercial') ||
      combinedText.includes('residential') ||
      combinedText.includes('luxury') ||
      combinedText.includes('apartment') ||
      combinedText.includes('flat') ||
      combinedText.includes('villa') ||
      combinedText.includes('plot') ||
      combinedText.includes('land');

    // Check if the contact has ANY explicit real estate preferences set
    const hasMinBudget = contact.min_budget !== null && contact.min_budget !== undefined && Number(contact.min_budget) > 0;
    const hasMaxBudget = contact.max_budget !== null && contact.max_budget !== undefined && Number(contact.max_budget) > 0;
    const hasNoBudget = !!contact.no_budget;
    const hasMinRoi = contact.min_roi !== null && contact.min_roi !== undefined && Number(contact.min_roi) > 0;
    
    const specificAreas = (contact.areas_of_interest || []).filter(
      (a) => !['not specific', 'any', ''].includes(a.toLowerCase().trim())
    );
    const hasSpecificAreas = specificAreas.length > 0;
    const hasCategoryInterests = (contact.property_interests || []).length > 0;

    const parsedTextBudget = parseBudgetFromText(combinedText);
    const hasParsedBudget = parsedTextBudget.min !== null || parsedTextBudget.max !== null;

    const yieldPattern = /(?:yielding|yield|roi|return)\s*(?:of|is|above|greater\s*than|>)?\s*(\d+(?:\.\d+)?)\s*%/g;
    const hasParsedRoi = yieldPattern.test(combinedText);
    yieldPattern.lastIndex = 0; // reset

    const hasRealEstatePreferences =
      hasMinBudget ||
      hasMaxBudget ||
      hasNoBudget ||
      hasMinRoi ||
      hasSpecificAreas ||
      hasCategoryInterests ||
      hasParsedBudget ||
      hasParsedRoi ||
      hasTypeMentions;

    if (!hasRealEstatePreferences) {
      // Skip contacts with no explicitly defined property preferences
      continue;
    }

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

    // Try parsing budget from text if fields are empty
    let textBudgetMatch = true;
    if (minBudget === null && maxBudget === null && !noBudget) {
      const parsedTextBudget = parseBudgetFromText(combinedText);
      if (parsedTextBudget.min !== null || parsedTextBudget.max !== null) {
        const minOk = parsedTextBudget.min === null || price >= parsedTextBudget.min;
        const maxOk = parsedTextBudget.max === null || price <= parsedTextBudget.max;
        textBudgetMatch = minOk && maxOk;
      }
    }
    budgetMatch = budgetMatch && textBudgetMatch;

    // 2. ROI Yield Match
    let roiMatch = false;
    const rentalIncome = property.rental_income ? Number(property.rental_income) : null;
    const propertyRoi = property.roi ? Number(property.roi) : (price > 0 && rentalIncome !== null ? (rentalIncome * 12 / price) * 100 : null);
    const minExpectedRoi = contact.min_roi ? Number(contact.min_roi) : null;

    if (minExpectedRoi !== null) {
      roiMatch = propertyRoi !== null && propertyRoi >= minExpectedRoi;
    } else {
      roiMatch = true;
      
      // Parse ROI/yield from notes if fields are empty
      const yieldPattern = /(?:yielding|yield|roi|return)\s*(?:of|is|above|greater\s*than|>)?\s*(\d+(?:\.\d+)?)\s*%/g;
      let yieldMatch;
      while ((yieldMatch = yieldPattern.exec(combinedText)) !== null) {
        const targetYield = parseFloat(yieldMatch[1]);
        if (propertyRoi === null || propertyRoi < targetYield) {
          roiMatch = false;
        } else {
          roiMatch = true;
        }
      }
    }

    // 3. Area Match
    let areaMatch = false;
    const areas = contact.areas_of_interest || [];
    const propLoc = (property.location || '').toLowerCase().replace(/\./g, '');
    const propSub = (property.sublocality || '').toLowerCase().replace(/\./g, '');
    const propCity = (property.city || '').toLowerCase().replace(/\./g, '');
    const propProject = (property.project || '').toLowerCase().replace(/\./g, '');
    const propType = (property.type || '').toLowerCase();

    // Yield-focused commercial property bypasses location filters
    const isLocationAgnostic = 
      areas.length === 0 ||
      areas.some((a) => {
        const lower = a.toLowerCase().trim();
        return lower === 'not specific' || lower === 'any' || lower === '';
      }) ||
      combinedText.includes('any location') ||
      combinedText.includes('no location preference') ||
      combinedText.includes('location agnostic') ||
      combinedText.includes('yield focused') ||
      combinedText.includes('roi focused') ||
      (minExpectedRoi !== null && propType.includes('commercial') && roiMatch);

    if (isLocationAgnostic) {
      areaMatch = true;
    } else {
      // Check substring match for any area of interest
      areaMatch = areas.some((area) => {
        const cleanArea = area.toLowerCase().replace(/\./g, '').trim();
        if (!cleanArea) return false;
        
        // Handle negative constraint: if Jayanagar is negated, Jayanagar must not match
        if (isNegated(combinedText, cleanArea)) {
          return false;
        }
        
        return (
          propLoc.includes(cleanArea) ||
          propSub.includes(cleanArea) ||
          propCity.includes(cleanArea) ||
          propProject.includes(cleanArea)
        );
      });

      // Parse locations explicitly mentioned in notes
      if (!areaMatch) {
        if (propSub && combinedText.includes(propSub) && !isNegated(combinedText, propSub)) {
          areaMatch = true;
        }
        if (propProject && combinedText.includes(propProject) && !isNegated(combinedText, propProject)) {
          areaMatch = true;
        }
      }
    }

    // Override location match to false if explicitly negated in notes
    if (propSub && isNegated(combinedText, propSub)) {
      areaMatch = false;
    }
    if (propProject && isNegated(combinedText, propProject)) {
      areaMatch = false;
    }

    // Heuristically infer category interests from notes text (hasTypeMentions is defined at the top of the loop)

    // 4. Property Interest/Type Match
    let interestMatch = false;
    const interests = contact.property_interests || [];
    const title = (property.title || '').toLowerCase();
    const desc = (property.description || '').toLowerCase();
    const features = (property.features || []).map((f) => f.toLowerCase());
    const combinedPropText = `${propType} ${title} ${desc} ${features.join(' ')}`;

    if (interests.length === 0) {
      interestMatch = !hasTypeMentions;
    } else {
      // Match if any contact interest keyword is found in property fields
      interestMatch = interests.some((interest) => {
        const cleanInt = interest.toLowerCase().trim();

        if (cleanInt === 'vacant plot' || cleanInt === 'vacant land') {
          const isLand = propType.includes('land') || propType.includes('plot');
          const hasVacantWord =
            title.includes('vacant') ||
            desc.includes('vacant') ||
            title.includes('plot') ||
            desc.includes('plot');
          return isLand || hasVacantWord;
        }

        if (cleanInt === 'vacant building') {
          const isNotLand = !propType.includes('land') && !propType.includes('plot');
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
        return title.includes(cleanInt) || desc.includes(cleanInt) || propType.includes(cleanInt);
      });
    }

    // Heuristically infer category interests from notes text
    let textInterestMatch = true;

    if (hasTypeMentions) {
      let matchFound = false;

      // Check negations first
      if (propType.includes('commercial') && isNegated(combinedText, 'commercial')) {
        textInterestMatch = false;
      } else if ((propType.includes('residential') || propType.includes('apartment') || propType.includes('flat') || propType.includes('villa') || propType.includes('house')) && isNegated(combinedText, 'residential')) {
        textInterestMatch = false;
      } else {
        if (combinedText.includes('commercial') && (propType.includes('commercial') || combinedPropText.includes('commercial') || combinedPropText.includes('office') || combinedPropText.includes('shop') || combinedPropText.includes('retail') || combinedPropText.includes('warehouse') || combinedPropText.includes('building'))) {
          matchFound = true;
        }
        if (combinedText.includes('residential') && (propType.includes('residential') || combinedPropText.includes('residential') || propType.includes('apartment') || propType.includes('flat') || propType.includes('villa') || propType.includes('house'))) {
          matchFound = true;
        }
        if (combinedText.includes('luxury') && (combinedPropText.includes('luxury') || combinedPropText.includes('premium') || combinedPropText.includes('penthouse') || combinedPropText.includes('villa'))) {
          matchFound = true;
        }
        if ((combinedText.includes('apartment') || combinedText.includes('flat')) && (propType.includes('apartment') || propType.includes('flat') || combinedPropText.includes('apartment') || combinedPropText.includes('flat'))) {
          matchFound = true;
        }
        if (combinedText.includes('villa') && (propType.includes('villa') || combinedPropText.includes('villa') || combinedPropText.includes('row house') || combinedPropText.includes('independent house'))) {
          matchFound = true;
        }
        if ((combinedText.includes('plot') || combinedText.includes('land')) && (propType.includes('plot') || propType.includes('land') || combinedPropText.includes('plot') || combinedPropText.includes('land') || combinedPropText.includes('site'))) {
          matchFound = true;
        }

        if (matchFound) {
          interestMatch = true; // Elevate category match
        }
      }
    }
    interestMatch = interestMatch && textInterestMatch;

    // Contact is a match if all criteria are satisfied
    if (budgetMatch && areaMatch && interestMatch && roiMatch) {
      let score = 0;

      // Budget component (max 25)
      if (minBudget || maxBudget || noBudget) {
        score += 25;
      } else {
        const parsedTextBudget = parseBudgetFromText(combinedText);
        if (parsedTextBudget.min !== null || parsedTextBudget.max !== null) {
          score += 25;
        } else {
          score += 15;
        }
      }

      // Location component (max 25)
      const specificAreas = areas.filter(
        (a) => !['not specific', 'any', ''].includes(a.toLowerCase().trim())
      );
      if (specificAreas.length > 0) {
        score += 25;
      } else if (isLocationAgnostic) {
        score += 25;
      } else if (propSub && combinedText.includes(propSub)) {
        score += 25;
      } else {
        score += 15;
      }

      // Category Interests component (max 25)
      if (interests.length > 0) {
        score += 25;
      } else if (hasTypeMentions) {
        score += 25;
      } else {
        score += 15;
      }

      // ROI Yield component (max 25)
      if (minExpectedRoi !== null) {
        score += 25;
      } else if (propertyRoi !== null) {
        if (combinedText.includes('roi') || combinedText.includes('yield') || combinedText.includes('rent yielding')) {
          score += 25;
        } else {
          score += 15;
        }
      } else {
        score += 15;
      }

      if (score > 100) score = 100;

      results.push({
        contact,
        score,
        matchedFields: {
          budget: budgetMatch,
          area: !!(areaMatch && (specificAreas.length > 0 || (propSub && combinedText.includes(propSub)) || (propProject && combinedText.includes(propProject)))),
          interest: interestMatch && (interests.length > 0 || hasTypeMentions),
          roi: roiMatch,
        },
      });
    }
  }

  // Sort descending by match score
  return results.sort((a, b) => b.score - a.score);
}

