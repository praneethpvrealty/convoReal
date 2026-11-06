export function focusFirstField(
  ids: readonly string[],
  root: Pick<Document, 'getElementById'> = document
): string | null {
  for (const id of ids) {
    const el = root.getElementById(id);
    if (!el) continue;
    el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    (el as HTMLElement).focus?.({ preventScroll: true });
    return id;
  }
  return null;
}
