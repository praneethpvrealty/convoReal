import type { Metadata } from 'next';
import RootPage, { generateMetadata as rootMetadata } from '@/app/page';

interface SellerPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}

async function showcaseParams({ params, searchParams }: SellerPageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  return {
    v: query.v,
    s: query.s,
    g: query.g,
    property_id: query.property_id,
    category: query.category,
    preview_style: query.preview_style,
    __seller: decodeURIComponent(slug),
  };
}

export async function generateMetadata(
  props: SellerPageProps
): Promise<Metadata> {
  return rootMetadata({ searchParams: showcaseParams(props) });
}

export default async function SellerPage(props: SellerPageProps) {
  return RootPage({ searchParams: showcaseParams(props) });
}
