"use client";

// Owners Den — notification preferences.

import { useState } from "react";
import { toast } from "sonner";

import { useDen, type DenMe } from "./den-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function DenSettingsContent() {
  const { me, refresh } = useDen();
  if (!me) {
    return <p className="text-sm text-muted-foreground">Loading settings…</p>;
  }
  // Keyed on the den user so the form state re-initializes if the
  // identity ever changes mid-session.
  return <DenSettingsForm key={me.den_user_id} me={me} refresh={refresh} />;
}

function DenSettingsForm({ me, refresh }: { me: DenMe; refresh: () => Promise<void> }) {
  const [displayName, setDisplayName] = useState(me.display_name || "");
  const [notifyMatches, setNotifyMatches] = useState(me.notify_matches);
  const [notifyBids, setNotifyBids] = useState(me.notify_bids);
  const [digestFrequency, setDigestFrequency] = useState<"off" | "daily" | "weekly">(
    me.digest_frequency,
  );
  const [saving, setSaving] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const res = await fetch("/api/den/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        display_name: displayName,
        notify_matches: notifyMatches,
        notify_bids: notifyBids,
        digest_frequency: digestFrequency,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      toast.error(body?.error || "Could not save settings");
      return;
    }
    await refresh();
    toast.success("Settings saved.");
  };

  return (
    <form onSubmit={handleSave} className="mx-auto flex max-w-xl flex-col gap-4">
      <div>
        <h1 className="text-xl font-black tracking-tight">Settings</h1>
        <p className="text-sm font-medium text-muted-foreground">
          Signed in with WhatsApp number {me?.phone ?? "…"}
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="s-name" className="text-xs font-bold">Your name</Label>
            <Input
              id="s-name"
              placeholder="How should we greet you?"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Notifications</CardTitle>
          <CardDescription className="text-xs">
            Delivered on WhatsApp and shown in the Den.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold">Buyer match alerts</p>
              <p className="text-[11px] text-muted-foreground">
                When a buyer matching your Deal Mode property shows up.
              </p>
            </div>
            <Switch checked={notifyMatches} onCheckedChange={setNotifyMatches} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold">Offer &amp; bid alerts</p>
              <p className="text-[11px] text-muted-foreground">
                When someone places or updates an offer on your property.
              </p>
            </div>
            <Switch checked={notifyBids} onCheckedChange={setNotifyBids} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold">Activity digest</p>
              <p className="text-[11px] text-muted-foreground">
                A WhatsApp summary of enquiries, shortlists and visits. Turning this off also
                stops the digests your agency sends.
              </p>
            </div>
            <Select
              value={digestFrequency}
              onValueChange={(v) => v && setDigestFrequency(v as "off" | "daily" | "weekly")}
            >
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">Off</SelectItem>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {me && me.links.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Your agencies</CardTitle>
            <CardDescription className="text-xs">
              Agencies managing one or more of your properties.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {me.links.map((l) => (
              <div
                key={l.account_id}
                className="rounded-lg border bg-muted/30 px-3 py-2 text-xs font-semibold"
              >
                {l.agency_name || "Agency"}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Button type="submit" disabled={saving} className="text-xs font-bold">
        {saving ? "Saving…" : "Save settings"}
      </Button>
    </form>
  );
}
