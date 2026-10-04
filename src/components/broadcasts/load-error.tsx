'use client';

import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface LoadErrorProps {
  what: string;
  onRetry: () => void;
  retrying?: boolean;
}

export function LoadError({ what, onRetry, retrying }: LoadErrorProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-10 text-center"
    >
      <p className="text-sm text-red-300">Couldn&apos;t load {what}.</p>
      <Button
        variant="outline"
        size="sm"
        onClick={onRetry}
        disabled={retrying}
        className="border-slate-700 text-slate-300"
      >
        <RefreshCw className={retrying ? 'animate-spin' : undefined} />
        Retry
      </Button>
    </div>
  );
}
