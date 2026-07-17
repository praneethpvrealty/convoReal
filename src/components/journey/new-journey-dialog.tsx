"use client";

/**
 * "New journey" picker — jump to (or start) any subject's journey.
 * Both selects are always offered regardless of which overview tab is
 * active; picking navigates to the focused view, where an empty
 * journey shows its add/import affordances.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, UserRound } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SearchableContactSelect } from "@/components/ui/searchable-contact-select";
import { SearchablePropertySelect } from "@/components/ui/searchable-property-select";
import type { Contact, Property } from "@/types";

export function NewJourneyDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const supabase = createClient();
  const router = useRouter();
  const { accountId } = useAuth();

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open || !accountId || loaded) return;
    let cancelled = false;
    (async () => {
      const [{ data: cs }, { data: ps }] = await Promise.all([
        supabase
          .from("contacts")
          .select("id, name, phone, name_tag")
          .eq("account_id", accountId)
          .order("created_at", { ascending: false })
          .limit(1000),
        supabase
          .from("properties")
          .select("id, title, property_code, location, sublocality, project")
          .eq("account_id", accountId)
          .order("created_at", { ascending: false })
          .limit(1000),
      ]);
      if (cancelled) return;
      setContacts((cs ?? []) as Contact[]);
      setProperties((ps ?? []) as Property[]);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, accountId, loaded, supabase]);

  const go = (path: string) => {
    onOpenChange(false);
    router.push(path, { scroll: false });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-slate-800 bg-slate-950">
        <DialogHeader>
          <DialogTitle className="text-slate-100">Open a journey</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-300">
              <UserRound className="h-3.5 w-3.5 text-primary" />
              Buyer journey
            </p>
            <SearchableContactSelect
              contacts={contacts.map((c) => ({
                id: c.id,
                name: c.name ?? c.phone,
                phone: c.phone,
                name_tag: c.name_tag,
              }))}
              value={null}
              onChange={(id) => id && go(`/journey?contact=${id}`)}
              placeholder={loaded ? "Select a contact…" : "Loading contacts…"}
            />
          </div>
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-300">
              <Building2 className="h-3.5 w-3.5 text-primary" />
              Property journey
            </p>
            <SearchablePropertySelect
              properties={properties}
              value={null}
              onChange={(id) => id && go(`/journey?property=${id}`)}
              placeholder={loaded ? "Select a property…" : "Loading properties…"}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
