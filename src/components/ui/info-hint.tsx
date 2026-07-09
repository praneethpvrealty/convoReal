"use client"

import { Info } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './tooltip'

interface InfoHintProps {
  text: string
}

export function InfoHint({ text }: InfoHintProps) {
  return (
    <TooltipProvider delay={300}>
      <Tooltip>
        <TooltipTrigger className="inline-flex items-center justify-center p-0.5 ml-1.5 text-slate-500 hover:text-slate-350 transition-colors focus-visible:outline-none cursor-help shrink-0">
          <Info className="size-3.5" />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-left text-[11px] font-normal leading-relaxed bg-slate-800 text-slate-100 border border-slate-700/50">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
