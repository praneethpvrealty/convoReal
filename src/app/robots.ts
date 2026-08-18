import type { MetadataRoute } from 'next';
import { fallbackSiteUrl } from '@/lib/showcase/site-url';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: [
          '/',
          '/api/public/agent/feed',
          '/api/public/agent/openapi.json',
        ],
        disallow: [
          '/api/',
          '/admin',
          '/ads',
          '/agents',
          '/auth/',
          '/automations',
          '/broadcasts',
          '/buyer',
          '/calendar',
          '/checkout-demo',
          '/contacts',
          '/dashboard',
          '/den',
          '/dev',
          '/docs/',
          '/flows',
          '/forgot-password',
          '/inbox',
          '/inventory',
          '/join/',
          '/journey',
          '/liaisons',
          '/login',
          '/pipelines',
          '/profile-setup',
          '/pulse',
          '/radar',
          '/requirements',
          '/reset-password',
          '/settings',
          '/signup',
          '/today',
          '/verify-phone',
        ],
      },
    ],
    sitemap: `${fallbackSiteUrl()}/sitemap.xml`,
  };
}
