'use client';

import { Info } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './tooltip';

interface InfoHintProps {
  text: string;
}

export function InfoHint({ text }: InfoHintProps) {
  return (
    <TooltipProvider delay={300}>
      <Tooltip>
        <TooltipTrigger className="hover:text-slate-350 ml-1.5 inline-flex shrink-0 cursor-help items-center justify-center p-0.5 text-slate-500 transition-colors focus-visible:outline-none">
          <Info className="size-3.5" />
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="max-w-xs border border-slate-700/50 bg-slate-800 text-left text-[11px] leading-relaxed font-normal text-slate-100"
        >
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
