import { Calculator, Landmark, Receipt, Route } from 'lucide-react';

import type { PublicToolIcon } from '@/lib/marketing/public-tools';

interface ToolIconProps {
  icon: PublicToolIcon;
  className?: string;
}

const ICONS = {
  landmark: Landmark,
  route: Route,
  receipt: Receipt,
  calculator: Calculator,
} as const;

export function ToolIcon({ icon, className }: ToolIconProps) {
  const Icon = ICONS[icon];
  return <Icon className={className} />;
}
