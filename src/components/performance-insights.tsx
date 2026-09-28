'use client';

import { SpeedInsights } from '@vercel/speed-insights/next';
import { sanitizePerformanceEvent } from '@/lib/performance-insights';

export function PerformanceInsights() {
  return (
    <SpeedInsights sampleRate={0.25} beforeSend={sanitizePerformanceEvent} />
  );
}
