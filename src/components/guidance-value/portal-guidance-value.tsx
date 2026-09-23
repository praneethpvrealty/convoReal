'use client';

import { Landmark } from 'lucide-react';

import { GuidanceValueTool } from './guidance-value-tool';

export function PortalGuidanceValue() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-black">
          <Landmark className="h-5 w-5" />
          Guidance value
        </h1>
        <p className="text-muted-foreground text-sm">
          Find the government guidance value of a Karnataka property. Upload the
          schedule part of its sale deed and we read the location and extent,
          then match it to the published notification.
        </p>
      </div>
      <GuidanceValueTool />
    </div>
  );
}
