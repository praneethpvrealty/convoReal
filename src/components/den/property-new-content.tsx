"use client";

// Owners Den — add-listing wizard (single form, owner-friendly).
// Creates a Pending Review property, then uploads any chosen photos.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { useDen } from "./den-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PROPERTY_TYPE_VALUES } from "@/lib/property-types";
import { ImagePlus, X } from "lucide-react";

export function DenPropertyNewContent() {
  const router = useRouter();
  const { me } = useDen();
  const links = useMemo(() => me?.links ?? [], [me]);

  const [accountId, setAccountId] = useState<string>("");
  const [listingType, setListingType] = useState<"Sale" | "Rent">("Sale");
  const [type, setType] = useState<string>("Flat/ Apartment");
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [city, setCity] = useState("Bangalore");
  const [price, setPrice] = useState("");
  const [rent, setRent] = useState("");
  const [maintenance, setMaintenance] = useState("");
  const [advance, setAdvance] = useState("");
  const [bedrooms, setBedrooms] = useState("");
  const [bathrooms, setBathrooms] = useState("");
  const [areaSqft, setAreaSqft] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);

  const effectiveAccountId = accountId || (links.length === 1 ? links[0].account_id : "");

  const num = (v: string): number | undefined => {
    const parsed = Number(v.replace(/[,\s]/g, ""));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (links.length > 1 && !effectiveAccountId) {
      toast.error("Choose which agency should manage this listing");
      return;
    }
    setSaving(true);
    const res = await fetch("/api/den/properties", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account_id: effectiveAccountId || undefined,
        title,
        location,
        city,
        type,
        listing_type: listingType,
        price: num(price),
        rent_per_month: num(rent),
        maintenance: num(maintenance),
        advance: num(advance),
        bedrooms: num(bedrooms),
        bathrooms: num(bathrooms),
        area_sqft: num(areaSqft),
        description: description.trim() || undefined,
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.property?.id) {
      toast.error(body?.error || "Could not save your listing");
      setSaving(false);
      return;
    }

    const propertyId = body.property.id as string;
    if (files.length > 0) {
      const form = new FormData();
      files.forEach((f) => form.append("files", f));
      const uploadRes = await fetch(`/api/den/properties/${propertyId}/images`, {
        method: "POST",
        body: form,
      });
      if (!uploadRes.ok) {
        toast.warning("Listing saved, but some photos failed to upload — add them from the listing page.");
      }
    }

    toast.success("Listing submitted! Your agency will review and publish it.");
    router.push(`/den/properties/${propertyId}`);
  };

  return (
    <form onSubmit={handleSubmit} className="mx-auto flex max-w-2xl flex-col gap-4">
      <div>
        <h1 className="text-xl font-black tracking-tight">List a property</h1>
        <p className="text-sm font-medium text-muted-foreground">
          Fill in what you know — your agency reviews everything before it goes live.
        </p>
      </div>

      {links.length > 1 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Managing agency</CardTitle>
          </CardHeader>
          <CardContent>
            <Select value={effectiveAccountId} onValueChange={(v) => v && setAccountId(v)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose the agency for this listing" />
              </SelectTrigger>
              <SelectContent>
                {links.map((l) => (
                  <SelectItem key={l.account_id} value={l.account_id}>
                    {l.agency_name || "Agency"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Basics</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex rounded-xl border bg-muted/40 p-1">
            {(["Sale", "Rent"] as const).map((lt) => (
              <button
                key={lt}
                type="button"
                onClick={() => setListingType(lt)}
                className={`flex-1 cursor-pointer rounded-lg px-3 py-2 text-xs font-bold transition-all ${
                  listingType === lt ? "bg-background shadow" : "text-muted-foreground"
                }`}
              >
                For {lt}
              </button>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="p-title" className="text-xs font-bold">Title</Label>
              <Input
                id="p-title"
                required
                placeholder="e.g. 3BHK flat in Indiranagar, east facing"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-bold">Property type</Label>
              <Select value={type} onValueChange={(v) => v && setType(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROPERTY_TYPE_VALUES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="p-city" className="text-xs font-bold">City</Label>
              <Input id="p-city" value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="p-location" className="text-xs font-bold">Locality / address area</Label>
              <Input
                id="p-location"
                required
                placeholder="e.g. Indiranagar 100 Feet Road"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{listingType === "Rent" ? "Rental terms" : "Price"}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {listingType === "Rent" ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="p-rent" className="text-xs font-bold">Rent per month (₹)</Label>
                <Input id="p-rent" required inputMode="numeric" placeholder="e.g. 45000" value={rent} onChange={(e) => setRent(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="p-maintenance" className="text-xs font-bold">Maintenance (₹/month)</Label>
                <Input id="p-maintenance" inputMode="numeric" placeholder="optional" value={maintenance} onChange={(e) => setMaintenance(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="p-advance" className="text-xs font-bold">Advance / deposit (₹)</Label>
                <Input id="p-advance" inputMode="numeric" placeholder="optional" value={advance} onChange={(e) => setAdvance(e.target.value)} />
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="p-price" className="text-xs font-bold">Expected price (₹)</Label>
              <Input id="p-price" required inputMode="numeric" placeholder="e.g. 12500000" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Details</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="p-bedrooms" className="text-xs font-bold">Bedrooms</Label>
              <Input id="p-bedrooms" inputMode="numeric" value={bedrooms} onChange={(e) => setBedrooms(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="p-bathrooms" className="text-xs font-bold">Bathrooms</Label>
              <Input id="p-bathrooms" inputMode="numeric" value={bathrooms} onChange={(e) => setBathrooms(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="p-area" className="text-xs font-bold">Area (sq.ft.)</Label>
              <Input id="p-area" inputMode="numeric" value={areaSqft} onChange={(e) => setAreaSqft(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="p-description" className="text-xs font-bold">Description</Label>
            <Textarea
              id="p-description"
              rows={4}
              placeholder="Anything a buyer or tenant should know — condition, furnishing, floor, parking, why it's special…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Photos</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed p-6 text-center transition-colors hover:border-primary/50 hover:bg-muted/40">
            <ImagePlus className="h-6 w-6 text-muted-foreground" />
            <span className="text-xs font-bold">Add photos</span>
            <span className="text-[11px] text-muted-foreground">Up to 10 photos, 15 MB each</span>
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                const chosen = Array.from(e.target.files || []);
                setFiles((prev) => [...prev, ...chosen].slice(0, 10));
                e.target.value = "";
              }}
            />
          </label>
          {files.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {files.map((f, idx) => (
                <span
                  key={`${f.name}-${idx}`}
                  className="flex items-center gap-1 rounded-full border bg-muted/40 px-2.5 py-1 text-[11px] font-semibold"
                >
                  {f.name.length > 24 ? `${f.name.slice(0, 21)}…` : f.name}
                  <button
                    type="button"
                    onClick={() => setFiles((prev) => prev.filter((_, i) => i !== idx))}
                    className="cursor-pointer text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Button type="submit" disabled={saving} className="h-11 text-xs font-bold">
        {saving ? "Submitting…" : "Submit for review"}
      </Button>
      <p className="text-center text-[11px] font-medium text-muted-foreground">
        Your agency verifies every listing before it&apos;s published. You can edit details any time.
      </p>
    </form>
  );
}
