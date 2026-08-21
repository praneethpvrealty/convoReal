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
    <section className="py-16 px-4 bg-slate-950">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-end justify-between mb-10">
          <div>
            <h2 className="text-2xl font-bold text-white tracking-tight sm:text-3xl">
              Latest Insights & News
            </h2>
            <p className="mt-3 text-sm text-slate-400 max-w-2xl">
              Stay updated with the latest real estate trends and market analysis.
            </p>
          </div>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {articles.map((article) => {
            const displayDate = article.published_at 
              ? new Date(article.published_at).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric'
                })
              : null;

            return (
              <Link
                key={article.id}
                href={`/articles/${article.slug}`}
                className="group relative flex flex-col items-start justify-between rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden hover:border-slate-700 transition-colors cursor-pointer"
              >
                {/* Article Image Placeholder or Real Image */}
                <div className="w-full aspect-[16/9] bg-slate-850 relative overflow-hidden">
                  {article.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img 
                      src={storagePublicUrl(article.image_url)} 
                      alt={article.title}
                      className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center bg-slate-900">
                      <Newspaper className="size-10 text-slate-700" />
                    </div>
                  )}
                  <div className="absolute inset-0 ring-1 ring-inset ring-slate-900/10 pointer-events-none" />
                </div>

                <div className="flex flex-1 flex-col p-6 w-full">
                  <div className="flex items-center gap-x-4 text-xs">
                    {displayDate && (
                      <time dateTime={article.published_at!} className="text-slate-500 flex items-center gap-1.5 font-medium">
                        <Calendar className="size-3.5" />
                        {displayDate}
                      </time>
                    )}
                  </div>
                  
                  <div className="group relative">
                    <h3 className="mt-3 text-lg font-semibold leading-tight text-white group-hover:text-primary transition-colors line-clamp-2">
                      {article.title}
                    </h3>
                    <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-slate-400">
                      {article.excerpt || article.content || 'Read more about this topic...'}
                    </p>
                  </div>
                  
                  <div className="mt-6 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-primary">
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
