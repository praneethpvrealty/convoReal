/**
 * Mobile bundle boundary for floor-plan galleries.
 *
 * The canonical sanitizers live in src/lib/inventory/floor-plans.ts on
 * the web/server side. Mobile only needs this structural, read-only
 * selector. Keeping it here prevents Metro from following a runtime
 * import outside the Expo project root while preserving the caller's
 * exact floor-plan type.
 */
export function plansWithImages<T extends { image: string | null }>(
  plans: T[] | null | undefined
): T[] {
  if (!Array.isArray(plans)) return [];
  return plans.filter((plan) => Boolean(plan.image));
}
