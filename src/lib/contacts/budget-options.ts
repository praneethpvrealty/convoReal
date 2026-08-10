/**
 * The budget ladder behind the Contacts page's Min/Max budget filters.
 *
 * Lifted out of contacts-content.tsx so the mobile app's copy of the
 * same ladder has an importable source of truth to be drift-checked
 * against (src/lib/mobile-parity.test.ts).
 */
export const BUDGET_OPTIONS = [
  { label: '5 Lakhs', value: '500000' },
  { label: '10 Lakhs', value: '1000000' },
  { label: '20 Lakhs', value: '2000000' },
  { label: '30 Lakhs', value: '3000000' },
  { label: '40 Lakhs', value: '4000000' },
  { label: '50 Lakhs', value: '5000000' },
  { label: '60 Lakhs', value: '6000000' },
  { label: '80 Lakhs', value: '8000000' },
  { label: '1 Crore', value: '10000000' },
  { label: '1.5 Crores', value: '15000000' },
  { label: '2 Crores', value: '20000000' },
  { label: '3 Crores', value: '30000000' },
  { label: '5 Crores', value: '50000000' },
  { label: '7 Crores', value: '70000000' },
  { label: '10 Crores', value: '100000000' },
  { label: '15 Crores', value: '150000000' },
  { label: '20 Crores', value: '200000000' },
  { label: '30 Crores', value: '300000000' },
  { label: '50 Crores', value: '500000000' },
  { label: '75 Crores', value: '750000000' },
  { label: '100 Crores', value: '1000000000' },
  { label: '150 Crores', value: '1500000000' },
  { label: '200 Crores', value: '2000000000' },
];
