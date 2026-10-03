'use client';

import { AgencyArticle } from '@/types';
import { storagePublicUrl } from '@/lib/storage/url';
import { ArrowRight, Calendar, Newspaper } from 'lucide-react';
import Link from 'next/link';

interface ArticlesSectionProps {
  articles: AgencyArticle[];
}

export function ArticlesSection({ articles }: ArticlesSectionProps) {
  if (!articles || articles.length === 0) return null;

  return (
    <section className="bg-slate-950 px-4 py-16">
      <div className="mx-auto max-w-5xl">
        <div className="mb-10 flex items-end justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Latest Insights & News
            </h2>
            <p className="mt-3 max-w-2xl text-sm text-slate-400">
              Stay updated with the latest real estate trends and market
              analysis.
            </p>
          </div>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {articles.map((article) => {
            const displayDate = article.published_at
              ? new Date(article.published_at).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })
              : null;

            return (
              <Link
                key={article.id}
                href={`/articles/${article.slug}`}
                className="group relative flex cursor-pointer flex-col items-start justify-between overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 transition-colors hover:border-slate-700"
              >
                {/* Article Image Placeholder or Real Image */}
                <div className="bg-slate-850 relative aspect-[16/9] w-full overflow-hidden">
                  {article.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={storagePublicUrl(article.image_url)}
                      alt={article.title}
                      className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center bg-slate-900">
                      <Newspaper className="size-10 text-slate-700" />
                    </div>
                  )}
                  <div className="pointer-events-none absolute inset-0 ring-1 ring-slate-900/10 ring-inset" />
                </div>

                <div className="flex w-full flex-1 flex-col p-6">
                  <div className="flex items-center gap-x-4 text-xs">
                    {displayDate && (
                      <time
                        dateTime={article.published_at!}
                        className="flex items-center gap-1.5 font-medium text-slate-500"
                      >
                        <Calendar className="size-3.5" />
                        {displayDate}
                      </time>
                    )}
                  </div>

                  <div className="group relative">
                    <h3 className="group-hover:text-primary mt-3 line-clamp-2 text-lg leading-tight font-semibold text-white transition-colors">
                      {article.title}
                    </h3>
                    <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-slate-400">
                      {article.excerpt ||
                        article.content ||
                        'Read more about this topic...'}
                    </p>
                  </div>

                  <div className="text-primary mt-6 flex items-center gap-1.5 text-xs font-bold tracking-wider uppercase">
                    Read Article
                    <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
