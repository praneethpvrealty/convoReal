# Design: AI photo enhancement for map/Street-View listing images

Status: **Design (not yet implemented)** · Owner: TBD

## Problem

Agents often list a property (especially land/plots) by uploading a **Google
Street View / Maps screenshot** as the listing photo — complete with the
Google watermark, road-name overlay, compass, and passing cars. It reads as
"a screenshot", not "a photo of the property", which weakens the listing and
the share preview.

Goal: when a Street-View-style image is uploaded (via the WhatsApp lister
flow or the web uploader), offer an **AI-enhanced** version that looks like a
clean, real photograph — **clearly labelled as AI-enhanced, never passed off
as a genuine photograph of the specific property.**

## Non-negotiable: honesty (this is the whole design constraint)

A real-estate CRM must not mislead buyers. So:

- The enhanced image is **always tagged `ai_enhanced`** and rendered with a
  small **"AI-enhanced · representative"** badge on the showcase/card, and
  written into image metadata/EXIF `Software: ConvoReal AI (representative)`.
- The **original is kept**, never overwritten. Enhancement adds a sibling
  image; the agent chooses the cover.
- Enhancement **cleans up** the source (remove the Google UI/watermark,
  improve exposure/framing) — it must **not fabricate** structures, amenities,
  or a different building. Prompting is constrained to "photo-realistic
  cleanup of the same scene", not "generate a nicer property".
- Disclosure copy is added to the showcase image caption when any
  `ai_enhanced` image is present.

## Where it plugs in

### Detection (is this a Street-View / map screenshot?)
Reuse the existing Gemini vision classifier pattern (`classifyImageOrText`,
`src/lib/ai/gemini.ts`). Add a tiny `isMapOrStreetViewImage(buffer)` →
boolean, prompted to detect: Google/Maps watermark, street-name overlays,
compass/pegman UI, dashcam/car-window framing. Runs on the `lite` tier.

- **WhatsApp lister flow** (`src/lib/ai/chatbot-engine.ts`, where
  `uploadPropertyImage` stores `parsedDraft.images`): after a photo is
  uploaded, if `isMapOrStreetViewImage` is true, reply with an interactive
  button **"✨ Make it look like a real photo (AI)"** rather than auto-running
  it (cost + honesty → explicit opt-in).
- **Web uploader** (`property-form` image step): show an "Enhance" affordance
  on any image the classifier flags.

### Enhancement (image-to-image)
Reuse **`POST /api/ai/enhance-image`** (already wraps Imagen 4 / Hugging Face,
burns `image_enhance` = 25 credits, respects `showcase_settings.flyer_ai_provider`).

- Extend it to accept `{ image, mode: 'cleanup' }` and, for `cleanup`, use an
  **image-to-image / edit** call with a constrained prompt, e.g.:
  > "Photo-realistic cleanup of THIS exact scene. Remove map/Street-View
  > watermarks, UI overlays, text, compass and vehicles. Keep the same
  > building, plot, road, trees and layout unchanged. Natural daylight, clean
  > exposure. Do not add or invent any structures."
- Imagen path: use the image-edit/inpaint variant (not text-only `predict`);
  HF path: an img2img model (e.g. SDXL-refiner / instruct-pix2pix). Provider
  choice already flows from `flyer_ai_provider`.
- On success, upload to `property-images` storage (mirror the flyer save),
  append to `properties.images`, and set the `ai_enhanced` flag (below).

### Data model
- New migration: `property_image_meta JSONB` on `properties` **or** a small
  `property_images_meta` table keyed by `(property_id, image_path)` with
  `{ source: 'upload'|'ai_enhanced'|'flyer', origin_image_path, model }`.
  Preferred: the table — it survives image reordering and records lineage
  (which original an enhancement came from).
- Showcase/card read this to render the "AI-enhanced" badge and disclosure.

## Flow (WhatsApp lister)

```
lister uploads photo
   → uploadPropertyImage (unchanged)
   → isMapOrStreetViewImage(buffer)?
        no  → done
        yes → bot: "This looks like a Street View screenshot.
                     ✨ Make an AI-enhanced version? (25 credits)"  [Yes] [No]
   → Yes → POST /api/ai/enhance-image { image, mode:'cleanup' }
         → store as ai_enhanced sibling, tag + badge
         → bot: "Added an AI-enhanced photo (labelled representative).
                  Original kept."  + preview
```

## Cost / limits
- 25 credits per enhancement (existing `image_enhance`), plan-gated to
  Solo Pro+ (existing `checkPlanLimit(ctx, 'ai')`).
- Opt-in only (no silent spend). Rate-limit per account.

## Open questions
1. Imagen 4 edit vs. a dedicated img2img model for faithful cleanup — needs a
   quick quality bake-off; instruct-pix2pix / SDXL img2img may hold geometry
   better than a generative edit.
2. Watermark/badge: burn a corner badge into the stored PNG, or render it in
   the UI only? (Burning it is safer for shared/downloaded images.)
3. Should `ai_enhanced` images be excluded from the OG/link-preview image, or
   allowed with the badge? (Lean: allow, with the badge burned in.)

## Explicitly out of scope
- Generating a "nicer" or different-looking property. Only faithful cleanup of
  the uploaded scene, labelled as AI-enhanced.
