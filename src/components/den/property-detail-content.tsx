"use client";

// Owners Den — property detail: Deal Mode control, editable fields,
// photo management.

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";

import { DealModeToggle } from "./deal-mode-toggle";
import { formatINR } from "./format";
import type { DenProperty } from "./properties-content";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { storagePublicUrl } from "@/lib/storage/url";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Building2, ImagePlus, MapPin } from "lucide-react";

export function DenPropertyDetailContent() {
  const params = useParams<{ id: string }>();
  const propertyId = params.id;

  const [property, setProperty] = useState<DenProperty | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Editable fields
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [rent, setRent] = useState("");
  const [maintenance, setMaintenance] = useState("");
  const [advance, setAdvance] = useState("");
  const [minBid, setMinBid] = useState("");

  useEffect(() => {
    fetch(`/api/den/properties/${propertyId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        const p = body?.property as DenProperty | undefined;
        if (p) {
          setProperty(p);
          setTitle(p.title || "");
          setDescription(p.description || "");
          setPrice(p.price ? String(p.price) : "");
          setRent(p.rent_per_month ? String(p.rent_per_month) : "");
          setMaintenance(p.maintenance ? String(p.maintenance) : "");
          setAdvance(p.advance ? String(p.advance) : "");
          setMinBid((p as { min_bid?: number | null }).min_bid ? String((p as { min_bid?: number | null }).min_bid) : "");
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [propertyId]);

  const num = (v: string): number | null => {
    if (!v.trim()) return null;
    const parsed = Number(v.replace(/[,\s]/g, ""));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!property) return;
    setSaving(true);
    const isRent = property.listing_type === "Rent";
    const res = await fetch(`/api/den/properties/${propertyId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        description: description.trim() || undefined,
        ...(isRent
          ? {
              rent_per_month: num(rent),
              maintenance: num(maintenance),
              advance: num(advance),
            }
          : { price: num(price) ?? 0 }),
        min_bid: num(minBid),
      }),
    });
    setSaving(false);
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(body?.error || "Could not save changes");
      return;
    }
    setProperty(body.property);
    toast.success("Changes saved — your agency sees them instantly.");
  };

  const handleUpload = async (chosen: File[]) => {
    if (chosen.length === 0) return;
    setUploading(true);
    const form = new FormData();
    chosen.forEach((f) => form.append("files", f));
    const res = await fetch(`/api/den/properties/${propertyId}/images`, {
      method: "POST",
      body: form,
    });
    setUploading(false);
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(body?.error || "Could not upload photos");
      return;
    }
    setProperty((prev) => (prev ? { ...prev, images: body.images } : prev));
    toast.success(`${body.added?.length ?? 0} photo(s) added.`);
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading your property…</p>;
  }
  if (!property) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <Building2 className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-semibold">Property not found</p>
        <Link
          href="/den/properties"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "text-xs font-bold")}
        >
          <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back to my properties
        </Link>
      </div>
    );
  }

  const isRent = property.listing_type === "Rent";

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href="/den/properties"
            className="mb-1 flex items-center gap-1 text-xs font-bold text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> My Properties
          </Link>
          <h1 className="truncate text-xl font-black tracking-tight">{property.title}</h1>
          <p className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            {property.location}
            {property.agency_name ? ` · managed by ${property.agency_name}` : ""}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-lg font-black text-primary">
            {isRent ? `${formatINR(property.rent_per_month)} /mo` : formatINR(property.price)}
          </p>
          <p className="text-[11px] font-semibold text-muted-foreground">
            {property.status === "Pending Review" ? "Pending agency review" : property.status}
          </p>
        </div>
      </div>

      <Card className="border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Deal Mode — ready to sell?</CardTitle>
        </CardHeader>
        <CardContent>
          <DealModeToggle
            propertyId={property.id}
            value={(property.deal_mode as "off" | "soft" | "aggressive") ?? "off"}
            onChanged={(mode) => setProperty((prev) => (prev ? { ...prev, deal_mode: mode } : prev))}
          />
          {!property.is_published && (
            <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] font-semibold text-amber-600">
              This listing isn&apos;t published yet — Deal Mode goes live once your agency approves it.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Photos ({property.images?.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {property.images?.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {property.images.map((url, idx) => (
                <div key={`${url}-${idx}`} className="aspect-video overflow-hidden rounded-lg bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={storagePublicUrl(url)} alt="" className="h-full w-full object-cover" />
                </div>
              ))}
            </div>
          )}
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed p-4 text-xs font-bold transition-colors hover:border-primary/50 hover:bg-muted/40">
            <ImagePlus className="h-4 w-4" />
            {uploading ? "Uploading…" : "Add photos"}
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                handleUpload(Array.from(e.target.files || []));
                e.target.value = "";
              }}
            />
          </label>
        </CardContent>
      </Card>

      <form onSubmit={handleSave}>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Edit details</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="d-title" className="text-xs font-bold">Title</Label>
              <Input id="d-title" required value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {isRent ? (
                <>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="d-rent" className="text-xs font-bold">Rent per month (₹)</Label>
                    <Input id="d-rent" inputMode="numeric" value={rent} onChange={(e) => setRent(e.target.value)} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="d-maintenance" className="text-xs font-bold">Maintenance (₹/month)</Label>
                    <Input id="d-maintenance" inputMode="numeric" value={maintenance} onChange={(e) => setMaintenance(e.target.value)} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="d-advance" className="text-xs font-bold">Advance / deposit (₹)</Label>
                    <Input id="d-advance" inputMode="numeric" value={advance} onChange={(e) => setAdvance(e.target.value)} />
                  </div>
                </>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="d-price" className="text-xs font-bold">Expected price (₹)</Label>
                  <Input id="d-price" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="d-min-bid" className="text-xs font-bold">Minimum offer (₹, optional)</Label>
                <Input
                  id="d-min-bid"
                  inputMode="numeric"
                  placeholder="Offers below this are refused"
                  value={minBid}
                  onChange={(e) => setMinBid(e.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="d-description" className="text-xs font-bold">Description</Label>
              <Textarea id="d-description" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <Button type="submit" disabled={saving} className="text-xs font-bold">
              {saving ? "Saving…" : "Save changes"}
            </Button>
            <p className="text-[11px] font-medium text-muted-foreground">
              Structural changes (property type, publishing, location) go through your agency.
            </p>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
