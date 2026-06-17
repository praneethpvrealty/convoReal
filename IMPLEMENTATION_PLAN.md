# Implementation Plan: ROI Yield Matching & Contact Requirements/Notes Matching

This document outlines the detailed design and implementation steps for introducing Expected Min ROI preferences, location-agnostic yield matching, and context-aware text parsing of contact notes and requirements in the real estate matching engine.

---

## 1. Goal Description

Many real estate buyers (especially institutional and commercial investors) prioritize rental yield (ROI %) over specific locations. 

We will upgrade the matching engine and contact fields to:
1. **Store Expected ROI**: Add a `min_roi` field to the contacts table to save a buyer's minimum expected yield (e.g. 4.5% ROI).
2. **Upgrade UI Forms**: Expose a "Expected Min ROI (%)" input field in contact forms and preference view sheets.
3. **Notes and Requirements Ingestion**: Pull contact notes (`contact_notes`) and requirements text fields to extract matching cues.
4. **Enhanced Matching Engine**: Filter properties such that `property.roi >= contact.min_roi`. Bypasses location filters for yield-focused commercial properties or location-agnostic requests. Parses keywords in notes/requirements to identify matching property types, project names, and budgets.

---

## 2. Database Migration Plan

We need to add a new `min_roi` numeric field to the `contacts` table.

### [NEW] Migration: `supabase/migrations/048_add_contacts_min_roi.sql`

```sql
-- Migration 048: Add Expected Min ROI to Contacts Table
ALTER TABLE contacts 
  ADD COLUMN IF NOT EXISTS min_roi NUMERIC CHECK (min_roi >= 0);

COMMENT ON COLUMN contacts.min_roi IS 'Minimum expected rental yield ROI (%) for buyer profiles.';
```

### [MODIFY] Combined Script: [RUN_IN_SUPABASE_SQL_EDITOR.sql](file:///Volumes/work/CRM%20project/waCrmCustomised/wacrm/supabase/RUN_IN_SUPABASE_SQL_EDITOR.sql)
Append this migration statement to the end of the master script.

---

## 3. TypeScript Type Definition Updates

Update the shared type definitions.

### [MODIFY] [src/types/index.ts](file:///Volumes/work/CRM%20project/waCrmCustomised/wacrm/src/types/index.ts)
```typescript
export interface Contact {
  id: string;
  user_id: string;
  phone: string;
  name?: string;
  email?: string;
  company?: string;
  classification?: 'Owner' | 'Seller' | 'Buyer' | 'Agent' | 'Others';
  avatar_url?: string;
  min_budget?: number;
  max_budget?: number;
  no_budget?: boolean;
  areas_of_interest?: string[];
  property_interests?: string[];
  status?: 'active' | 'pending_review';
  lead_temp?: 'HOT' | 'COLD' | 'Not Responding' | 'Dead' | null;
  last_contacted_at?: string | null;
  referrer?: string;
  referrer_contact_id?: string | null;
  requirements?: string | null;
  min_roi?: number | null; // <-- NEW
  contact_notes?: { note_text: string }[] | null; // <-- NEW
  last_inquired_property_id?: string | null;
  source?: string | null;
  created_at: string;
  updated_at: string;
}
```

---

## 4. UI Component Updates

### [MODIFY] [contact-form.tsx](file:///Volumes/work/CRM%20project/waCrmCustomised/wacrm/src/components/contacts/contact-form.tsx)
- Define state `const [minRoi, setMinRoi] = useState('');` and set it on load inside `useEffect`.
- Add an Expected Min ROI (%) number input field inside the Real Estate Preferences group.
- Save `min_roi: minRoi ? Number(minRoi) : null` in the `handleSubmit` payload.

### [MODIFY] [contact-detail-view.tsx](file:///Volumes/work/CRM%20project/waCrmCustomised/wacrm/src/components/contacts/contact-detail-view.tsx)
- Define state `const [editMinRoi, setEditMinRoi] = useState('');` and set it on load.
- Render the Expected Min ROI (%) control inside the Preferences tab, below the budget limits inputs.
- Save `min_roi: editMinRoi ? Number(editMinRoi) : null` in the `savePreferences` update call.

---

## 5. Data Fetching Enhancements

To read contact notes in the matching engine, we need to select `contact_notes` when querying contacts:

### [MODIFY] [property-form.tsx](file:///Volumes/work/CRM%20project/waCrmCustomised/wacrm/src/components/inventory/property-form.tsx)
- Modify the `fetchContacts` select query to fetch linked notes:
  ```typescript
  .from('contacts')
  .select('*, contact_notes(note_text)')
  ```

### [MODIFY] [property-share-dialog.tsx](file:///Volumes/work/CRM%20project/waCrmCustomised/wacrm/src/components/inventory/property-share-dialog.tsx)
- Modify the `fetchContacts` query similarly:
  ```typescript
  .from('contacts')
  .select('*, contact_notes(note_text)')
  ```

---

## 6. Matching Engine Re-engineering

### [MODIFY] [matching.ts](file:///Volumes/work/CRM%20project/waCrmCustomised/wacrm/src/lib/matching.ts)

1. **Text Aggregation**: Combine the contact's requirements text and notes text:
   ```typescript
   const notesText = (contact.contact_notes || []).map((n) => n.note_text).join(' ');
   const requirementsText = contact.requirements || '';
   const combinedText = (requirementsText + ' ' + notesText).toLowerCase();
   ```

2. **Yield/ROI Match**:
   - Calculate property ROI (`property.roi` or dynamically using monthly rental income against total listing price: `(rental_income * 12) / price * 100`).
   - If `contact.min_roi` is set, a match occurs only if `propertyRoi >= contact.min_roi`.
   - Otherwise, scan the combined text for yield expressions (e.g., "yielding 4%", "ROI 5%", "high yield") and parse numeric values if found.

3. **Location-Agnostic Override**:
   - Bypasses location filters (`areaMatch = true`) if:
     - The contact's `areas_of_interest` list is empty, contains `'any'`, or contains `'not specific'`.
     - OR the combined text notes contain `"any location"`, `"no location preference"`, or `"location agnostic"`.
     - OR `minExpectedRoi` is set, the property matches the yield threshold, and the property type is `'commercial'`.

4. **Context-Aware Property Category & Landmark Matching**:
   - Scan the combined text for keywords like `residential`, `luxury`, `apartment`, `commercial`, `villa`, `plot`, `land` and match against property attributes.
   - Scan the combined text for property landmarks or project names (e.g. if the project "Blue Waters" is in notes/requirements, it will automatically match a property with that project name).

5. **Heuristic Budget Parsing**:
   - Parse budget phrases from combined text (e.g., "budget 2 Cr", "under 80 Lakhs", "below 1.5 Crore") to validate property price if fields are empty.

6. **Refactored Scoring**:
   - Score out of 100 points: Budget (25 pts), Location (25 pts), Category Interests (25 pts), ROI Yield (25 pts).

---

## 7. Verification Plan

### Automated Tests
Create a comprehensive test suite in [matching.test.ts](file:///Volumes/work/CRM%20project/waCrmCustomised/wacrm/src/lib/matching.test.ts):
- Verify properties match only if their ROI meets the contact's `min_roi` constraint.
- Verify yield-focused investors match properties in different areas if they have no location preference.
- Verify contacts requesting "luxury apartments" or "commercial buildings" in notes/requirements match corresponding properties.
- Verify a contact matching a project name like "Blue Waters" in notes matches a property with that project name.
- Run typecheck and vitest suite.
