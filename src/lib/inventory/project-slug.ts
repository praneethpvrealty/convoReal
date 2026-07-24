import type { Property } from '@/types';

export function slugifyProject(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function findProjectProperties(
  properties: Property[],
  slug: string
): Property[] {
  const normalized = slugifyProject(slug);
  if (!normalized) return [];
  return properties.filter(
    (p) => p.project && slugifyProject(p.project) === normalized
  );
}
