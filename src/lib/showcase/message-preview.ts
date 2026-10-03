export type PreviewSegment =
  { kind: 'text'; text: string } | { kind: 'name' | 'link'; text: string };

export function previewSegments(
  template: string,
  values: { name: string | null; portalUrl: string }
): PreviewSegment[] {
  const firstName = values.name?.trim().split(/\s+/)[0] || 'there';
  const segments: PreviewSegment[] = [];
  for (const part of template.split(/(\{name\}|\{portalUrl\})/)) {
    if (!part) continue;
    if (part === '{name}') segments.push({ kind: 'name', text: firstName });
    else if (part === '{portalUrl}')
      segments.push({ kind: 'link', text: values.portalUrl });
    else segments.push({ kind: 'text', text: part });
  }
  return segments;
}
