'use client';

import { useRef, useState, type RefObject } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { toast } from 'sonner';
import {
  CirclePlay,
  ExternalLink,
  FileText,
  Loader2,
  Lock,
  Plus,
  Star,
  Trash2,
  Unlock,
  Upload,
} from 'lucide-react';
import type { Property } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PropertyBlueprintLoader } from '@/components/ui/property-blueprint-loader';
import { ListingVideoCard } from '@/components/inventory/listing-video-card';
import { FloorPlansEditor } from '@/components/inventory/floor-plans-editor';
import { compressImageOnClient } from '@/components/inventory/property-form/client-image';
import { AI_FEATURE_COSTS } from '@/lib/credits/types';
import {
  looksLikeDocument,
  orderForCover,
  samplePixels,
} from '@/lib/inventory/cover-photo';
import { DOCUMENT_SIZE_LIMIT } from '@/lib/inventory/documents';
import { storagePublicUrl } from '@/lib/storage/url';
import type { SetPropertyFormField } from '@/hooks/usePropertyForm';
import type { PropertyFormValues } from '@/lib/inventory/property-form-state';

interface MediaSectionProps {
  values: PropertyFormValues;
  set: SetPropertyFormField;
  property?: Property | null;
  accountId: string | null;
  supabase: SupabaseClient;
  canEdit: boolean;
  isLand: boolean;
  uploadPlanImage: (file: File) => Promise<string | null>;
  readingEKhata: boolean;
  eKhataInputRef: RefObject<HTMLInputElement | null>;
  onReadEKhata: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
}

function isDocumentImage(blob: Blob): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 48;
        canvas.height = 48;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(false);
          return;
        }
        ctx.drawImage(img, 0, 0, 48, 48);
        resolve(
          looksLikeDocument(samplePixels(ctx.getImageData(0, 0, 48, 48).data))
        );
      } catch {
        resolve(false);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(false);
    };
    img.src = url;
  });
}

export function MediaSection({
  values,
  set,
  property,
  accountId,
  supabase,
  canEdit,
  isLand,
  uploadPlanImage,
  readingEKhata,
  eKhataInputRef,
  onReadEKhata,
}: MediaSectionProps) {
  const {
    images,
    privateImages,
    defaultImageIndex,
    videoRemoved,
    documents,
    floorPlans,
  } = values;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);

  const [lockingImagePath, setLockingImagePath] = useState<string | null>(null);
  const [removingVideo, setRemovingVideo] = useState(false);
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

  async function onUploadImages(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if (!accountId) {
      toast.error('Account not loaded, please try again.');
      return;
    }

    setUploadingImage(true);
    const uploaded: { url: string; document: boolean }[] = [];

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        // 5MB limit
        if (file.size > 5 * 1024 * 1024) {
          toast.error(`File "${file.name}" is too large. Max size is 5MB.`);
          continue;
        }

        // Compress image before upload
        let uploadFile: File | Blob = file;
        if (
          file.type.startsWith('image/') &&
          file.type !== 'image/svg+xml' &&
          file.type !== 'image/gif'
        ) {
          try {
            uploadFile = await compressImageOnClient(file);
          } catch {
            // Fallback to original if compression fails
          }
        }

        const ext = 'jpg';
        const randomStr = Math.random().toString(36).substring(2, 7);
        // Scoped by account ID folder
        const path = `${accountId}/img-${Date.now()}-${randomStr}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from('property-images')
          .upload(path, uploadFile, {
            cacheControl: '3600',
            upsert: true,
            contentType: 'image/jpeg',
          });

        if (uploadError) {
          throw new Error(`Upload failed: ${uploadError.message}`);
        }

        uploaded.push({
          url: `property-images/${path}`,
          document: await isDocumentImage(uploadFile),
        });
      }

      if (uploaded.length > 0) {
        const uploadedUrls = orderForCover(uploaded, (u) => u.document).map(
          (u) => u.url
        );
        const documents = uploaded.filter((u) => u.document).length;
        set('images', (prev) => {
          const filteredPrev = prev.filter((url) => url.trim().length > 0);
          return [...filteredPrev, ...uploadedUrls];
        });
        toast.success(
          documents > 0
            ? `Uploaded ${uploaded.length} image(s) — ${documents} look${documents === 1 ? 's' : ''} like a document and ${documents === 1 ? 'was' : 'were'} placed after the photos`
            : `Uploaded ${uploaded.length} image(s)`
        );
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Image upload failed';
      toast.error(message);
    } finally {
      setUploadingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function onUploadDocuments(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if (!accountId) {
      toast.error('Account not loaded, please try again.');
      return;
    }

    setUploadingDocument(true);
    const uploadedUrls: string[] = [];

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        if (file.size > DOCUMENT_SIZE_LIMIT) {
          const mb = (file.size / (1024 * 1024)).toFixed(1);
          toast.error(
            `File "${file.name}" is ${mb}MB. Max size is ${Math.round(DOCUMENT_SIZE_LIMIT / (1024 * 1024))}MB.`
          );
          continue;
        }

        const ext = file.name.split('.').pop()?.toLowerCase() || 'pdf';
        const randomStr = Math.random().toString(36).substring(2, 7);
        // Scoped by account ID folder
        const path = `${accountId}/doc-${Date.now()}-${randomStr}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from('property-documents')
          .upload(path, file, {
            cacheControl: '3600',
            upsert: true,
            contentType: file.type,
          });

        if (uploadError) {
          throw new Error(`Upload failed: ${uploadError.message}`);
        }

        uploadedUrls.push(`property-documents/${path}`);
      }

      if (uploadedUrls.length > 0) {
        const newDocs = uploadedUrls.map((url) => {
          const filename = url.split('/').pop()?.split('?')[0] || '';
          const decoded = decodeURIComponent(filename);
          const cleanName = decoded
            .replace(/^[a-fA-F0-9-]+\/(img-|doc-|file-)\d+-[a-zA-Z0-9]+-/, '')
            .replace(/^[a-fA-F0-9-]+\/(img-|doc-|file-)\d+-/, '')
            .split('.')
            .slice(0, -1)
            .join('.');
          return { url, title: cleanName };
        });

        set('documents', (prev) => {
          const filteredPrev = prev
            .filter((doc) => {
              const url = typeof doc === 'string' ? doc : doc?.url;
              return url && url.trim().length > 0;
            })
            .map((doc) => {
              if (typeof doc === 'string') return { url: doc, title: '' };
              return doc;
            });
          return [...filteredPrev, ...newDocs];
        });
        toast.success(`Uploaded ${uploadedUrls.length} document(s)`);
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Document upload failed';
      toast.error(message);
    } finally {
      setUploadingDocument(false);
      if (documentInputRef.current) documentInputRef.current.value = '';
    }
  }

  function handleAddDocumentUrl() {
    set('documents', (prev) => [...prev, { url: '', title: '' }]);
  }

  function handleRemoveDocumentUrl(index: number) {
    if (documents.length === 1) {
      set('documents', [{ url: '', title: '' }]);
    } else {
      set('documents', (prev) => prev.filter((_, i) => i !== index));
    }
  }

  function handleDocumentUrlChange(index: number, value: string) {
    set('documents', (prev) => {
      const copy = [...prev];
      const target = copy[index];
      if (typeof target === 'string') {
        copy[index] = { url: value, title: '' };
      } else {
        copy[index] = { ...target, url: value };
      }
      return copy;
    });
  }

  function handleDocumentTitleChange(index: number, value: string) {
    set('documents', (prev) => {
      const copy = [...prev];
      const target = copy[index];
      if (typeof target === 'string') {
        copy[index] = { url: '', title: value };
      } else {
        copy[index] = { ...target, title: value };
      }
      return copy;
    });
  }

  function handleAddImageUrl() {
    set('images', (prev) => [...prev, '']);
  }

  function handleRemoveImageUrl(index: number) {
    if (images.length === 1) {
      set('images', ['']);
    } else {
      set('images', (prev) => prev.filter((_, i) => i !== index));
    }
  }

  function handleImageUrlChange(index: number, value: string) {
    set('images', (prev) => {
      const copy = [...prev];
      copy[index] = value;
      return copy;
    });
  }

  function handleSetDefaultImage(index: number) {
    set('defaultImageIndex', index);
    toast.success('Selected image set as default listing photo');
  }

  async function handleToggleImageLock(
    path: string,
    action: 'lock' | 'unlock'
  ) {
    if (!property?.id || lockingImagePath) return;
    setLockingImagePath(path);
    try {
      const response = await fetch(
        `/api/properties/${property.id}/private-images`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path, action }),
        }
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to update photo privacy');
      }
      set('images', data.data.images.length > 0 ? data.data.images : ['']);
      set('privateImages', data.data.private_images || []);
      toast.success(
        action === 'lock'
          ? 'Photo moved to private — revealed only on approved requests'
          : 'Photo is public again'
      );
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to update photo privacy'
      );
    } finally {
      setLockingImagePath(null);
    }
  }

  async function handleRemoveVideo() {
    if (!property?.id || removingVideo) return;
    setRemovingVideo(true);
    try {
      const response = await fetch(
        `/api/properties/${property.id}/generate-video`,
        {
          method: 'DELETE',
        }
      );
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to remove the video');
      }
      set('videoRemoved', true);
      toast.success(
        'Listing video removed — it no longer plays in the Showcase'
      );
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to remove the video'
      );
    } finally {
      setRemovingVideo(false);
    }
  }

  return (
    <>
      {/* Auto-generated listing video — needs a saved
      property with photos, so edit mode only. */}
      {property?.id && (
        <div className="col-span-2">
          <ListingVideoCard
            key={videoRemoved ? 'video-removed' : 'video'}
            propertyId={property.id}
          />
        </div>
      )}

      {/* Images URLs Input */}
      <div
        id="pf-media"
        className="col-span-2 scroll-mt-2 space-y-3 rounded-lg border border-slate-800 bg-slate-950/20 p-4"
      >
        <div className="flex items-center justify-between">
          <Label className="text-slate-300">Property Images</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingImage}
            className="text-primary hover:bg-primary/10 flex h-7 items-center gap-1 text-xs font-semibold"
          >
            {uploadingImage ? (
              <>
                <PropertyBlueprintLoader size={14} label="Uploading" />{' '}
                Uploading...
              </>
            ) : (
              <>
                <Upload className="size-3" /> Upload
              </>
            )}
          </Button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={onUploadImages}
            multiple
            accept="image/*"
            className="hidden"
          />
        </div>

        <div className="max-h-40 space-y-2 overflow-y-auto pr-1">
          {property?.video_url &&
            property.video_status === 'ready' &&
            !videoRemoved && (
              <div className="flex items-center gap-2">
                <video
                  src={storagePublicUrl(property.video_url)}
                  muted
                  playsInline
                  preload="metadata"
                  className="size-8 shrink-0 rounded border border-slate-700 object-cover"
                />
                <span className="flex-1 truncate text-xs text-slate-400">
                  Listing video — plays in the Showcase gallery
                </span>
                <a
                  href={storagePublicUrl(property.video_url)}
                  target="_blank"
                  rel="noreferrer"
                  title="Play video"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-slate-400 hover:text-white"
                >
                  <CirclePlay className="size-3.5" />
                </a>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleRemoveVideo}
                  disabled={removingVideo}
                  title="Remove video"
                  className="h-8 w-8 shrink-0 p-0 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                >
                  {removingVideo ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="size-3.5" />
                  )}
                </Button>
              </div>
            )}
          {images.map((imgUrl, idx) => (
            <div key={idx} className="flex items-center gap-2">
              {imgUrl.trim().length > 0 && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  key={imgUrl}
                  src={storagePublicUrl(imgUrl)}
                  alt={`Property ${idx + 1}`}
                  className="size-8 shrink-0 rounded border border-slate-700 object-cover"
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
              )}
              <Input
                value={imgUrl}
                onChange={(e) => handleImageUrlChange(idx, e.target.value)}
                placeholder="Image URL (e.g. https://...)"
                className="h-8 flex-1 border-slate-700 bg-slate-800 text-xs text-white placeholder:text-slate-500"
              />
              {imgUrl.trim().length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleSetDefaultImage(idx)}
                  className={`h-8 w-8 shrink-0 p-0 ${idx === defaultImageIndex ? 'text-amber-400' : 'text-slate-500 hover:text-amber-400'}`}
                  title={
                    idx === defaultImageIndex
                      ? 'Default Image'
                      : 'Set as Default'
                  }
                >
                  <Star
                    className={`size-3.5 ${idx === defaultImageIndex ? 'fill-amber-400' : ''}`}
                  />
                </Button>
              )}
              {imgUrl.trim().length > 0 && property?.id && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleToggleImageLock(imgUrl, 'lock')}
                  disabled={lockingImagePath !== null}
                  className="h-8 w-8 shrink-0 p-0 text-slate-500 hover:text-amber-400"
                  title="Make private — hidden from the showcase, revealed only on approved requests (e.g. facade / street view)"
                >
                  {lockingImagePath === imgUrl ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Lock className="size-3.5" />
                  )}
                </Button>
              )}
              {images.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemoveImageUrl(idx)}
                  className="h-8 w-8 shrink-0 p-0 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </div>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleAddImageUrl}
            className="mt-1 flex h-7 items-center gap-1 text-xs font-semibold text-slate-400 hover:text-white"
          >
            <Plus className="size-3" /> Add Image URL
          </Button>
        </div>

        {property?.id && privateImages.length > 0 && (
          <div className="space-y-2 border-t border-slate-800 pt-3">
            <Label className="flex items-center gap-1.5 text-xs text-amber-400">
              <Lock className="size-3" /> Private Photos
              <span className="text-[10px] font-medium text-slate-500">
                Hidden from the showcase — sent only with approved location
                reveals
              </span>
            </Label>
            {privateImages.map((path, idx) => (
              <div key={path} className="flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/properties/${property.id}/private-images/${idx}`}
                  alt={`Private ${idx + 1}`}
                  className="size-8 shrink-0 rounded border border-amber-900/50 object-cover"
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
                <span className="flex-1 truncate text-xs text-slate-500">
                  {path}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleToggleImageLock(path, 'unlock')}
                  disabled={lockingImagePath !== null}
                  className="flex h-8 shrink-0 items-center gap-1 px-2 text-xs text-slate-400 hover:text-white"
                  title="Make public again"
                >
                  {lockingImagePath === path ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <>
                      <Unlock className="size-3.5" /> Unlock
                    </>
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Floor Plans */}
      <div className="col-span-2 space-y-3 rounded-lg border border-slate-800 bg-slate-950/20 p-4">
        <FloorPlansEditor
          value={floorPlans}
          onChange={(next) => set('floorPlans', next)}
          onUpload={uploadPlanImage}
          disabled={!canEdit}
          isLand={isLand}
        />
      </div>

      {/* Property Documents */}
      <div className="col-span-2 space-y-3 rounded-lg border border-slate-800 bg-slate-950/20 p-4">
        <div className="flex items-center justify-between">
          <Label className="text-slate-300">Property Documents</Label>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => eKhataInputRef.current?.click()}
              disabled={readingEKhata || !canEdit}
              className="text-primary hover:bg-primary/10 flex h-7 items-center gap-1 text-xs font-semibold"
            >
              {readingEKhata ? (
                <>
                  <Loader2 className="size-3 animate-spin" /> Reading...
                </>
              ) : (
                <>
                  <FileText className="size-3" /> Read e-Khata ·{' '}
                  {AI_FEATURE_COSTS.listing_parse} cr
                </>
              )}
            </Button>
            <input
              type="file"
              ref={eKhataInputRef}
              onChange={onReadEKhata}
              accept=".pdf,.png,.jpg,.jpeg,.webp"
              className="hidden"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => documentInputRef.current?.click()}
              disabled={uploadingDocument}
              className="text-primary hover:bg-primary/10 flex h-7 items-center gap-1 text-xs font-semibold"
            >
              {uploadingDocument ? (
                <>
                  <PropertyBlueprintLoader size={14} label="Uploading" />{' '}
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="size-3" /> Upload
                </>
              )}
            </Button>
            <input
              type="file"
              ref={documentInputRef}
              onChange={onUploadDocuments}
              multiple
              accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp,text/plain"
              className="hidden"
            />
          </div>
        </div>

        <div className="max-h-60 space-y-3 overflow-y-auto pr-1">
          {documents.map((doc, idx) => (
            <div
              key={idx}
              className="border-slate-850 flex flex-col items-start gap-2 rounded-lg border bg-slate-950/30 p-2.5 sm:flex-row sm:items-center"
            >
              <div className="grid w-full flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
                <Input
                  value={doc.title}
                  onChange={(e) =>
                    handleDocumentTitleChange(idx, e.target.value)
                  }
                  placeholder="Document Title (e.g. Layout Sketch)"
                  className="h-8 w-full border-slate-700 bg-slate-800 text-xs text-white placeholder:text-slate-500"
                />
                <Input
                  value={doc.url}
                  onChange={(e) => handleDocumentUrlChange(idx, e.target.value)}
                  placeholder="Document URL (e.g. https://...)"
                  className="h-8 w-full border-slate-700 bg-slate-800 font-mono text-xs text-white placeholder:text-slate-500"
                />
              </div>
              <div className="flex shrink-0 gap-1.5 self-end sm:self-auto">
                {doc.url.trim().length > 0 && (
                  <a
                    href={storagePublicUrl(doc.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-slate-700 bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white"
                    title="Open Document"
                  >
                    <ExternalLink className="size-3.5" />
                  </a>
                )}
                {documents.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveDocumentUrl(idx)}
                    className="h-8 w-8 shrink-0 p-0 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleAddDocumentUrl}
            className="mt-1 flex h-7 items-center gap-1 text-xs font-semibold text-slate-400 hover:text-white"
          >
            <Plus className="size-3" /> Add Document URL
          </Button>
        </div>
      </div>
    </>
  );
}
