export interface ChipSplit {
  visible: string[];
  hidden: string[];
  hiddenTitle: string | undefined;
}

export const TABLE_CHIP_CAP = 2;

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
