const MAX_LOCATION_FILTERS = 8;

export function appendLocationFilters(
  params: URLSearchParams,
  locations: readonly string[]
): URLSearchParams {
  const seen = new Set<string>();

  for (const location of locations) {
    const label = location.trim();
    const key = label.toLocaleLowerCase();
    if (!label || seen.has(key)) continue;

    seen.add(key);
    params.append('location', label);
    if (seen.size === MAX_LOCATION_FILTERS) break;
  }

  return params;
}
