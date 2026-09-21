'use client';

import { useRouter } from 'next/navigation';
import type { Property } from '@/types';
import {
  Archive,
  ArchiveRestore,
  Copy,
  Edit,
  Globe,
  Loader2,
  Mail,
  Megaphone,
  MoreHorizontal,
  Sparkles,
  Trash2,
  Waypoints,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface PropertyActionHandlers {
  onEdit: (property: Property) => void;
  onDelete: (property: Property) => void;
  onDuplicate?: (property: Property) => Promise<void>;
  onArchive?: (property: Property) => Promise<void>;
  onFlyer?: (property: Property) => void;
  onPromote?: (property: Property) => void;
  onEmailShare?: (property: Property) => void;
  onPortals?: (property: Property) => void;
}

interface PropertyActionsMenuProps extends PropertyActionHandlers {
  property: Property;
  canEdit: boolean;
  duplicating?: boolean;
  className?: string;
}

export function PropertyActionsMenu({
  property,
  canEdit,
  duplicating = false,
  className,
  onEdit,
  onDelete,
  onDuplicate,
  onArchive,
  onFlyer,
  onPromote,
  onEmailShare,
  onPortals,
}: PropertyActionsMenuProps) {
  const router = useRouter();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`More actions for ${property.title}`}
        className={
          className ??
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-800 text-slate-300 transition-colors hover:bg-slate-800 hover:text-white'
        }
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onClick={(e) => e.stopPropagation()}
        className="w-56 border-slate-700 bg-slate-900 text-slate-200"
      >
        {canEdit && (
          <DropdownMenuItem onClick={() => onEdit(property)}>
            <Edit className="size-3.5" /> Edit details
          </DropdownMenuItem>
        )}
        {onFlyer && (
          <DropdownMenuItem onClick={() => onFlyer(property)}>
            <Sparkles className="text-primary size-3.5" /> AI flyer
          </DropdownMenuItem>
        )}
        {onPromote && (
          <DropdownMenuItem onClick={() => onPromote(property)}>
            <Megaphone className="text-primary size-3.5" /> Promote with Meta
            ads
          </DropdownMenuItem>
        )}
        {onEmailShare && (
          <DropdownMenuItem onClick={() => onEmailShare(property)}>
            <Mail className="text-primary size-3.5" /> Share via email
          </DropdownMenuItem>
        )}
        {onPortals && (
          <DropdownMenuItem onClick={() => onPortals(property)}>
            <Globe className="text-primary size-3.5" /> Post to portals
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onClick={() => router.push(`/journey?property=${property.id}`)}
        >
          <Waypoints className="size-3.5 text-sky-400" /> Journey map
        </DropdownMenuItem>
        {canEdit && onDuplicate && (
          <DropdownMenuItem
            disabled={duplicating}
            onClick={() => onDuplicate(property)}
          >
            {duplicating ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Copy className="size-3.5" />
            )}{' '}
            Duplicate
          </DropdownMenuItem>
        )}
        {canEdit && (
          <>
            <DropdownMenuSeparator className="bg-slate-800" />
            {onArchive && property.status !== 'Pending Review' && (
              <DropdownMenuItem onClick={() => onArchive(property)}>
                {property.status === 'Archived' ? (
                  <>
                    <ArchiveRestore className="size-3.5 text-amber-400" />{' '}
                    Restore
                  </>
                ) : (
                  <>
                    <Archive className="size-3.5" /> Archive
                  </>
                )}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              variant="destructive"
              onClick={() => onDelete(property)}
            >
              <Trash2 className="size-3.5" /> Delete…
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
