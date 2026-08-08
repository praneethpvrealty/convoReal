"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Copy,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  TriangleAlert,
  UserMinus,
  Users,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MAX_GROUP_PARTICIPANTS } from "@/lib/whatsapp/groups";
import { cn } from "@/lib/utils";

interface GroupRow {
  id: string;
  wa_group_id: string | null;
  subject: string;
  description: string | null;
  invite_link: string | null;
  status: "pending" | "active" | "suspended" | "deleted" | "failed";
  participant_count: number;
  error_message: string | null;
  created_at: string;
}

interface Participant {
  id: string;
  wa_id: string;
  contact_id: string | null;
  joined_at: string;
  contact?: { id: string; name: string | null; phone: string } | null;
}

const STATUS_COPY: Record<GroupRow["status"], { label: string; hint: string; tone: string }> = {
  pending: {
    label: "Creating",
    // Creation is asynchronous — the invite link works before the group
    // can be messaged, and agents need to know that is normal.
    hint: "WhatsApp is still confirming this group. The invite link already works; sending becomes available once it does.",
    tone: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  },
  active: {
    label: "Active",
    hint: "",
    tone: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  },
  suspended: {
    label: "Suspended",
    hint: "WhatsApp has suspended this group. Nothing can be sent to it until the suspension lifts.",
    tone: "bg-rose-500/10 text-rose-300 border-rose-500/30",
  },
  failed: {
    label: "Failed",
    hint: "WhatsApp refused to create this group.",
    tone: "bg-rose-500/10 text-rose-300 border-rose-500/30",
  },
  deleted: { label: "Deleted", hint: "", tone: "bg-slate-700/40 text-slate-400 border-slate-700" },
};

async function fetchGroups(): Promise<GroupRow[]> {
  const response = await fetch("/api/whatsapp/groups");
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Could not load groups");
  return payload.data ?? [];
}

export default function GroupsContent() {
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState("");
  const [creating, setCreating] = useState(false);
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);

  const { data: groups, isLoading, error } = useQuery({
    queryKey: ["whatsapp-groups"],
    queryFn: fetchGroups,
  });

  const create = useMutation({
    mutationFn: async (nextSubject: string) => {
      const response = await fetch("/api/whatsapp/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: nextSubject }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not create the group");
      return payload.data;
    },
    onSuccess: () => {
      setSubject("");
      setCreating(false);
      toast.success("Group created — WhatsApp is confirming it now");
      queryClient.invalidateQueries({ queryKey: ["whatsapp-groups"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // The OBA gate is the single most likely reason nothing here works, so
  // it gets its own explanation rather than a generic failure.
  const notEnabled = error?.message?.includes("Official Business Account");

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">WhatsApp Groups</h1>
          <p className="mt-1 text-sm text-slate-400">
            Up to {MAX_GROUP_PARTICIPANTS} people per group, joining by invite link. Groups
            take text, media and approved templates — not buttons or lists, so the bot stays
            out of them.
          </p>
        </div>
        <Button onClick={() => setCreating((v) => !v)} className="gap-2">
          <Plus className="h-4 w-4" />
          New group
        </Button>
      </header>

      {creating ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (subject.trim()) create.mutate(subject.trim());
          }}
          className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/50 p-4"
        >
          <Input
            autoFocus
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Group name — e.g. Kondapur 3BHK · Sharma deal"
            className="min-w-64 flex-1"
          />
          <Button type="submit" disabled={!subject.trim() || create.isPending}>
            {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
            Cancel
          </Button>
        </form>
      ) : null}

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading groups…
        </div>
      ) : error ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p>{error.message}</p>
            {notEnabled ? (
              <p className="mt-1 text-amber-200/70">
                The Groups API is open only to numbers on an Official Business Account.
                Everything else in the inbox keeps working without it.
              </p>
            ) : null}
          </div>
        </div>
      ) : groups?.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-8 text-center">
          <Users className="mx-auto h-8 w-8 text-slate-600" />
          <p className="mt-3 text-sm text-slate-300">No groups yet</p>
          <p className="mt-1 text-xs text-slate-500">
            A group is useful when a deal has more than two sides — buyer, owner and a
            liaison in one thread.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups?.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              expanded={openGroupId === group.id}
              onToggle={() => setOpenGroupId(openGroupId === group.id ? null : group.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function GroupCard({
  group,
  expanded,
  onToggle,
}: {
  group: GroupRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const queryClient = useQueryClient();
  const status = STATUS_COPY[group.status];

  const { data: detail } = useQuery({
    queryKey: ["whatsapp-group", group.id],
    enabled: expanded,
    queryFn: async () => {
      const response = await fetch(`/api/whatsapp/groups/${group.id}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not load the group");
      return payload.data as { participants: Participant[] };
    },
  });

  const act = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const response = await fetch(`/api/whatsapp/groups/${group.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "That did not work");
      return payload.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-groups"] });
      queryClient.invalidateQueries({ queryKey: ["whatsapp-group", group.id] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function copyLink() {
    if (!group.invite_link) return;
    void navigator.clipboard.writeText(group.invite_link);
    toast.success("Invite link copied");
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 p-4 text-left"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-800">
          <Users className="h-5 w-5 text-slate-400" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-slate-100">{group.subject}</p>
          <p className="text-xs text-slate-500">
            {group.participant_count} of {MAX_GROUP_PARTICIPANTS} joined
          </p>
        </div>
        <span className={cn("rounded-full border px-2 py-0.5 text-xs", status.tone)}>
          {status.label}
        </span>
      </button>

      {status.hint ? (
        <p className="px-4 pb-3 text-xs text-slate-400">
          {status.hint}
          {group.error_message ? ` — ${group.error_message}` : ""}
        </p>
      ) : null}

      {expanded ? (
        <div className="space-y-4 border-t border-slate-800 p-4">
          {group.invite_link ? (
            <div className="flex flex-wrap items-center gap-2">
              <Link2 className="h-4 w-4 shrink-0 text-slate-500" />
              <code className="min-w-0 flex-1 truncate rounded bg-slate-950/60 px-2 py-1 text-xs text-slate-300">
                {group.invite_link}
              </code>
              <Button size="sm" variant="secondary" onClick={copyLink} className="gap-1.5">
                <Copy className="h-3.5 w-3.5" />
                Copy
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={act.isPending}
                onClick={() => act.mutate({ action: "reset_invite_link" })}
                className="gap-1.5"
                // Rotating invalidates the old link for everyone holding it.
                title="Generate a new link — anyone holding the old one can no longer join"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Reset
              </Button>
            </div>
          ) : null}

          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              Participants
            </p>
            {detail?.participants.length ? (
              <ul className="space-y-1">
                {detail.participants.map((participant) => (
                  <li
                    key={participant.id}
                    className="flex items-center gap-2 rounded-lg bg-slate-950/40 px-3 py-2"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-200">
                      {participant.contact?.name || participant.wa_id}
                    </span>
                    {!participant.contact ? (
                      // Deliberately not auto-created as a lead: joining
                      // a group by link is not consent to be one.
                      <span className="text-xs text-slate-500">Not a contact</span>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={act.isPending}
                      onClick={() =>
                        act.mutate({
                          action: "remove_participants",
                          wa_ids: [participant.wa_id],
                        })
                      }
                      className="gap-1.5 text-rose-300 hover:text-rose-200"
                    >
                      <UserMinus className="h-3.5 w-3.5" />
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">
                Nobody has joined yet — share the invite link above.
              </p>
            )}
          </div>

          <div className="flex justify-end border-t border-slate-800 pt-3">
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5 text-rose-300 hover:text-rose-200"
              onClick={async () => {
                const response = await fetch(`/api/whatsapp/groups/${group.id}`, {
                  method: "DELETE",
                });
                const payload = await response.json();
                if (!response.ok) {
                  toast.error(payload.error || "Could not delete the group");
                  return;
                }
                toast.success("Group deleted");
                queryClient.invalidateQueries({ queryKey: ["whatsapp-groups"] });
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete group
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
