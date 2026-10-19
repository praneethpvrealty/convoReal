// Showcase share scoping — the one rule a catalog link is built from,
// bundled from src/ through `@shared/` so a link built on the phone
// opens exactly what the same choices open from the desktop.
export {
  applyShowcaseScope,
  type ShareCategory,
  type ShareScope,
  type ShowcaseScopeOptions,
  withShowcaseVisitor,
} from '@shared/lib/inventory/showcase-share-scope';
