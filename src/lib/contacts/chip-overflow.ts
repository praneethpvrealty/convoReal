export interface ChipSplit {
  visible: string[];
  hidden: string[];
  hiddenTitle: string | undefined;
}

export const TABLE_CHIP_CAP = 2;

export interface TagChip {
  id: string;
  name: string;
  color: string;
}

export function splitTagChips(
  tags: readonly TagChip[],
  cap = TABLE_CHIP_CAP
): { visible: TagChip[]; hidden: TagChip[]; hiddenTitle: string | undefined } {
  const seen = new Set<string>();
  const unique: TagChip[] = [];
  for (const tag of tags) {
    const name = tag.name.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    unique.push({ ...tag, name });
  }
  const visible = unique.slice(0, cap);
  const hidden = unique.slice(cap);
  return {
    visible,
    hidden,
    hiddenTitle:
      hidden.length > 0 ? hidden.map((t) => t.name).join(', ') : undefined,
  };
}

export function splitChips(
  values: readonly string[],
  cap = TABLE_CHIP_CAP
): ChipSplit {
  const unique = Array.from(
    new Set(values.map((v) => v.trim()).filter((v) => v.length > 0))
  );
  const visible = unique.slice(0, cap);
  const hidden = unique.slice(cap);
  return {
    visible,
    hidden,
    hiddenTitle: hidden.length > 0 ? hidden.join(', ') : undefined,
  };
}
