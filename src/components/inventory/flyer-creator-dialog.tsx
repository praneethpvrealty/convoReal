'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { Property } from '@/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { storagePublicUrl } from '@/lib/storage/url';
import { BRANDING } from '@/config/branding';
import { PropertyBlueprintLoader } from '@/components/ui/property-blueprint-loader';
import { AI_FEATURE_COSTS } from '@/lib/credits/types';
import { useTopupModal } from '@/components/layout/topup-modal-context';
import {
  Sparkles,
  Download,
  Loader2,
  RefreshCw,
  Save,
} from 'lucide-react';

interface FlyerCreatorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  property: Property | null;
  onSaved?: () => void;
}

type TemplateStyle = 'minimalist' | 'glassmorphism' | 'vignette';

export function FlyerCreatorDialog({
  open,
  onOpenChange,
  property,
  onSaved,
}: FlyerCreatorDialogProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { user, accountId } = useAuth();
  const { openTopupModal } = useTopupModal();

  // Settings states
  const [imageSource, setImageSource] = useState<'original' | 'ai'>('original');
  const [template, setTemplate] = useState<TemplateStyle>('minimalist');
  const [aiPrompt, setAiPrompt] = useState('');
  const [generatingAiImage, setGeneratingAiImage] = useState(false);
  const [aiImageUrl, setAiImageUrl] = useState<string | null>(null);

  // Field display toggles
  const [showPrice, setShowPrice] = useState(true);
  const [showCode, setShowCode] = useState(true);
  const [showLocation, setShowLocation] = useState(true);
  const [showBranding, setShowBranding] = useState(true);

  // Branding Custom Text
  const [brandName, setBrandName] = useState(BRANDING.name);
  const [brandContact, setBrandContact] = useState('');

  // Image loading caches to avoid reloading during simple toggle modifications
  const [bgImageElement, setBgImageElement] = useState<HTMLImageElement | null>(null);
  const [currency, setCurrency] = useState('INR');

  // Prefill defaults on open
  const lastPropertyIdRef = useRef<string | null>(null);
  const lastOpenRef = useRef<boolean>(false);

  useEffect(() => {
    if (open && property && (open !== lastOpenRef.current || property.id !== lastPropertyIdRef.current)) {
      const hasOriginal = property.images && property.images.length > 0;
      setImageSource(hasOriginal ? 'original' : 'ai');
      
      setAiPrompt(
        `A high-end, professional architectural photograph of a luxury ${property.type.toLowerCase()} in ${property.sublocality || property.city || 'Bangalore'}, clean composition, beautiful morning sunlight, modern real estate marketing photography style`
      );

      // Default brand details
      setBrandName(BRANDING.name);
      setBrandContact(user?.phone || '');
      setAiImageUrl(null);
      setBgImageElement(null);

      // Load currency settings from showcase_settings
      if (accountId) {
        const supabaseClient = createClient();
        supabaseClient
          .from('showcase_settings')
          .select('currency')
          .eq('account_id', accountId)
          .maybeSingle()
          .then(({ data }) => {
            if (data?.currency) {
              setCurrency(data.currency);
            }
          });
      }
    }
    lastOpenRef.current = open;
    lastPropertyIdRef.current = property?.id || null;
  }, [open, property, user, accountId]);

  // Generate image using Imagen 4 model
  async function handleGenerateAIImage() {
    if (!aiPrompt.trim()) {
      toast.error('AI prompt cannot be empty');
      return;
    }
    setGeneratingAiImage(true);
    try {
      const response = await fetch('/api/ai/enhance-image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: aiPrompt.trim(),
          aspectRatio: '1:1',
          image: (property && property.images && property.images.length > 0) ? storagePublicUrl(property.images[0]) : null,
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        if (response.status === 402) {
          if (errData.upgradeRequired && typeof errData.upgradeRequired === 'string') {
            toast.error(errData.error || 'AI features require a plan upgrade.', {
              action: { label: 'Upgrade plan', onClick: () => window.location.href = '/settings?tab=billing' },
            });
          } else {
            toast.error(errData.error || `You've used all your credits for this month.`, {
              action: { label: 'Buy credits', onClick: openTopupModal },
            });
          }
          return;
        }
        throw new Error(errData.error || 'Failed to generate AI image');
      }

      const resData = await response.json();
      setAiImageUrl(resData.image);
      setImageSource('ai');
      toast.success('AI Listing image generated successfully!');
    } catch (err: unknown) {
      console.error(err);
      const message = err instanceof Error ? err.message : 'Failed to generate image';
      toast.error(message);
    } finally {
      setGeneratingAiImage(false);
    }
  }

  // Load image element safely (handles CORS and state tracking)
  useEffect(() => {
    if (!open || !property) return;
    setBgImageElement(null);

    const hasOriginal = property.images && property.images.length > 0;
    const urlToLoad = imageSource === 'original' && hasOriginal
      ? storagePublicUrl(property.images[0])
      : aiImageUrl;

    if (!urlToLoad) return;

    const img = new Image();
    img.crossOrigin = 'anonymous'; // Safe to download stained canvas from external Supabase storage
    img.onload = () => {
      setBgImageElement(img);
    };
    img.onerror = () => {
      console.error('Failed to load image from URL:', urlToLoad);
      if (imageSource === 'original') {
        toast.error('Could not load original property image. Falling back to placeholder background.');
      }
    };
    img.src = urlToLoad;
  }, [open, property, imageSource, aiImageUrl]);

  // Core Canvas Drawing Logic
  const drawFlyer = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !property) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = 1080;
    const height = 1080;
    canvas.width = width;
    canvas.height = height;

    // Clear Canvas
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, width, height);

    // 1. Draw Background Listing Image
    if (bgImageElement) {
      // Center-cover crop image drawing
      const imgRatio = bgImageElement.width / bgImageElement.height;
      const canvasRatio = width / height;
      let sx = 0, sy = 0, sw = bgImageElement.width, sh = bgImageElement.height;
      if (imgRatio > canvasRatio) {
        sw = bgImageElement.height * canvasRatio;
        sx = (bgImageElement.width - sw) / 2;
      } else {
        sh = bgImageElement.width / canvasRatio;
        sy = (bgImageElement.height - sh) / 2;
      }
      ctx.drawImage(bgImageElement, sx, sy, sw, sh, 0, 0, width, height);
    } else {
      // Background gradient placeholder when no image is loaded
      const placeholderGrad = ctx.createRadialGradient(width/2, height/2, width/6, width/2, height/2, width*0.8);
      placeholderGrad.addColorStop(0, '#1e293b');
      placeholderGrad.addColorStop(1, '#020617');
      ctx.fillStyle = placeholderGrad;
      ctx.fillRect(0, 0, width, height);

      // Icon overlay
      ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.font = '320px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🏡', width / 2, height / 2 - 40);
    }

    // Rounded rectangle helper
    const drawRoundRect = (
      x: number,
      y: number,
      w: number,
      h: number,
      r: number,
      fill: string,
      stroke?: string
    ) => {
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(x, y, w, h, r);
      } else {
        ctx.rect(x, y, w, h);
      }
      ctx.fillStyle = fill;
      ctx.fill();
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    };

    // Format Price helper
    const formatPrice = (amount: number) => {
      if (currency === 'INR') {
        if (amount >= 10000000) {
          const cr = amount / 10000000;
          return `₹${cr.toFixed(2).replace(/\.00$/, '')} Cr`;
        } else if (amount >= 100000) {
          const lakhs = amount / 100000;
          return `₹${lakhs.toFixed(2).replace(/\.00$/, '')} Lakhs`;
        }
        return `₹${amount.toLocaleString('en-IN')}`;
      }
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: currency,
        maximumFractionDigits: 0,
      }).format(amount);
    };

    // Truncate text helper using canvas measurement
    const truncateText = (text: string, maxWidth: number) => {
      if (ctx.measureText(text).width <= maxWidth) return text;
      let truncated = text;
      while (truncated.length > 0 && ctx.measureText(truncated + '...').width > maxWidth) {
        truncated = truncated.slice(0, -1);
      }
      return truncated + '...';
    };

    // Wrap text into lines helper using canvas measurement
    const getWrappedLines = (text: string, maxWidth: number): string[] => {
      const words = text.split(' ');
      const lines: string[] = [];
      let currentLine = words[0] || '';

      for (let i = 1; i < words.length; i++) {
        const word = words[i];
        const width = ctx.measureText(currentLine + ' ' + word).width;
        if (width < maxWidth) {
          currentLine += ' ' + word;
        } else {
          lines.push(currentLine);
          currentLine = word;
        }
      }
      if (currentLine) {
        lines.push(currentLine);
      }
      return lines;
    };

    // 2. Draw Badges in the Upper Section (Property Code and Category)
    if (showCode && property.property_code) {
      // Draw Property Code tag
      drawRoundRect(48, 48, 220, 56, 12, '#6366f1'); // Solid indigo background
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 24px "Outfit", "Inter", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(property.property_code, 48 + 110, 48 + 28);
    }

    // Always draw Category Type Badge on top right
    const categoryText = property.type.toUpperCase();
    ctx.font = 'bold 20px "Outfit", "Inter", sans-serif';
    const textWidth = ctx.measureText(categoryText).width;
    const padding = 20;
    const badgeW = textWidth + padding * 2;
    drawRoundRect(width - badgeW - 48, 48, badgeW, 56, 12, 'rgba(15, 23, 42, 0.85)', 'rgba(255, 255, 255, 0.15)');
    ctx.fillStyle = '#38bdf8'; // Sky blue text
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(categoryText, width - badgeW - 48 + badgeW / 2, 48 + 28);

    // 3. Draw Overlay Templates
    if (template === 'minimalist') {
      // BOTTOM GRADIENT STRIP
      const grad = ctx.createLinearGradient(0, height - 360, 0, height);
      grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
      grad.addColorStop(0.4, 'rgba(2, 6, 23, 0.85)');
      grad.addColorStop(1, 'rgba(2, 6, 23, 0.98)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, height - 360, width, 360);

      // Calculate Price Badge width first to constrain title width
      let priceBadgeW = 0;
      const priceLabel = formatPrice(property.price);
      if (showPrice) {
        ctx.font = 'bold 48px "Outfit", "Inter", sans-serif';
        const priceW = ctx.measureText(priceLabel).width;
        priceBadgeW = priceW + 40;
      }

      // TITLE & CATEGORY (Left side)
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 44px "Outfit", "Inter", sans-serif';
      
      const maxTitleWidth = showPrice ? (width - priceBadgeW - 136) : (width - 96);
      const titleLines = getWrappedLines(property.title, maxTitleWidth);
      if (titleLines.length > 2) {
        titleLines[1] = truncateText(titleLines[1] + ' ' + titleLines.slice(2).join(' '), maxTitleWidth);
        titleLines.splice(2);
      }

      if (titleLines.length === 2) {
        ctx.fillText(titleLines[0], 48, height - 240);
        ctx.fillText(titleLines[1], 48, height - 195);
      } else {
        ctx.fillText(titleLines[0] || '', 48, height - 210);
      }

      // LOCATION (Left bottom)
      if (showLocation) {
        ctx.fillStyle = '#94a3b8'; // Muted slate text
        ctx.font = '600 28px "Outfit", "Inter", sans-serif';
        const locationText = truncateText(`📍 ${property.location}`, width - 96);
        ctx.fillText(locationText, 48, height - 145);
      }

      // PRICE BADGE (Right side)
      if (showPrice) {
        drawRoundRect(width - priceBadgeW - 48, height - 260, priceBadgeW, 80, 16, '#10b981'); // Emerald solid green
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(priceLabel, width - priceBadgeW - 48 + priceBadgeW / 2, height - 260 + 40);
      }

      // BRANDING DETAILS BAR
      if (showBranding) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.fillRect(0, height - 90, width, 90);

        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 24px "Outfit", "Inter", sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const leftBrandText = truncateText(brandName, width / 2 - 60);
        ctx.fillText(leftBrandText, 48, height - 45);

        if (brandContact) {
          ctx.fillStyle = '#f8fafc';
          ctx.textAlign = 'right';
          const rightBrandText = truncateText(`📞 ${brandContact}`, width / 2 - 60);
          ctx.fillText(rightBrandText, width - 48, height - 45);
        }
      }

    } else if (template === 'glassmorphism') {
      // FLOATING GLASS SLATE
      const cardW = width - 96;
      const cardH = 250;
      const cardX = 48;
      const cardY = height - cardH - 48;

      // Draw glass backing (dark background with frosted borders)
      drawRoundRect(cardX, cardY, cardW, cardH, 24, 'rgba(15, 23, 42, 0.88)', 'rgba(255, 255, 255, 0.18)');

      // Calculate price width first to constrain title width
      let priceW = 0;
      const priceLabel = formatPrice(property.price);
      if (showPrice) {
        ctx.font = 'bold 44px "Outfit", "Inter", sans-serif';
        priceW = ctx.measureText(priceLabel).width;
      }

      // TITLE
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 42px "Outfit", "Inter", sans-serif';
      
      const maxTitleWidth = showPrice ? (cardW - priceW - 112) : (cardW - 72);
      const titleLines = getWrappedLines(property.title, maxTitleWidth);
      if (titleLines.length > 2) {
        titleLines[1] = truncateText(titleLines[1] + ' ' + titleLines.slice(2).join(' '), maxTitleWidth);
        titleLines.splice(2);
      }

      if (titleLines.length === 2) {
        ctx.fillText(titleLines[0], cardX + 36, cardY + 28);
        ctx.fillText(titleLines[1], cardX + 36, cardY + 74);
      } else {
        ctx.fillText(titleLines[0] || '', cardX + 36, cardY + 36);
      }

      // LOCATION
      if (showLocation) {
        ctx.fillStyle = '#cbd5e1';
        ctx.font = '500 24px "Outfit", "Inter", sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        const locY = titleLines.length === 2 ? cardY + 120 : cardY + 100;
        const locationText = truncateText(`📍 ${property.location}`, cardW - 72);
        ctx.fillText(locationText, cardX + 36, locY);
      }

      // PRICE
      if (showPrice) {
        ctx.fillStyle = '#34d399'; // Mint green
        ctx.font = 'bold 44px "Outfit", "Inter", sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText(priceLabel, cardX + cardW - 36, cardY + 36);
      }

      // BRANDING
      if (showBranding) {
        // Divider line
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cardX + 36, cardY + 160);
        ctx.lineTo(cardX + cardW - 36, cardY + 160);
        ctx.stroke();

        ctx.fillStyle = '#a5b4fc';
        ctx.font = 'bold 22px "Outfit", "Inter", sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        const brandLeftText = truncateText(brandName, cardW / 2 - 40);
        ctx.fillText(brandLeftText, cardX + 36, cardY + 184);

        if (brandContact) {
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'right';
          const contactRightText = truncateText(`Contact: ${brandContact}`, cardW / 2 - 40);
          ctx.fillText(contactRightText, cardX + cardW - 36, cardY + 184);
        }
      }

    } else if (template === 'vignette') {
      // RADIAL DARK VIGNETTE OVERLAY
      const vignette = ctx.createRadialGradient(width/2, height/2, width/5, width/2, height/2, width*0.75);
      vignette.addColorStop(0, 'rgba(2, 6, 23, 0.1)');
      vignette.addColorStop(0.6, 'rgba(2, 6, 23, 0.7)');
      vignette.addColorStop(1, 'rgba(2, 6, 23, 0.95)');
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, width, height);

      // Outer gold box line border
      ctx.strokeStyle = 'rgba(217, 119, 6, 0.3)'; // Amber/gold subtle frame
      ctx.lineWidth = 4;
      ctx.strokeRect(32, 32, width - 64, height - 64);

      // CENTER DETAILS
      ctx.textAlign = 'center';

      // TITLE
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 48px "Outfit", "Inter", sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      
      const maxTitleWidth = width - 160;
      const titleLines = getWrappedLines(property.title, maxTitleWidth);
      if (titleLines.length > 2) {
        titleLines[1] = truncateText(titleLines[1] + ' ' + titleLines.slice(2).join(' '), maxTitleWidth);
        titleLines.splice(2);
      }

      if (titleLines.length === 2) {
        ctx.fillText(titleLines[0], width / 2, height / 2 - 150);
        ctx.fillText(titleLines[1], width / 2, height / 2 - 95);
      } else {
        ctx.fillText(titleLines[0] || '', width / 2, height / 2 - 120);
      }

      // CATEGORY
      ctx.fillStyle = '#fbbf24'; // Amber Gold
      ctx.font = 'bold 28px "Outfit", "Inter", sans-serif';
      const categoryLabel = `★   ${property.type.toUpperCase()}   ★`;
      const categoryText = truncateText(categoryLabel, width - 160);
      ctx.fillText(categoryText, width / 2, height / 2 - 40);

      // PRICE
      if (showPrice) {
        const priceLabel = formatPrice(property.price);
        ctx.fillStyle = '#ffffff';
        ctx.font = '800 68px "Outfit", "Inter", sans-serif';
        ctx.fillText(priceLabel, width / 2, height / 2 + 50);
      }

      // LOCATION
      if (showLocation) {
        ctx.fillStyle = '#cbd5e1';
        ctx.font = '500 28px "Outfit", "Inter", sans-serif';
        const locationText = truncateText(`📍 ${property.location}`, width - 160);
        ctx.fillText(locationText, width / 2, height / 2 + 130);
      }

      // BRANDING
      if (showBranding) {
        ctx.fillStyle = '#f59e0b';
        ctx.font = 'bold 26px "Outfit", "Inter", sans-serif';
        const brandText = truncateText(brandName, width - 160);
        ctx.fillText(brandText, width / 2, height - 130);

        if (brandContact) {
          ctx.fillStyle = '#ffffff';
          ctx.font = '600 24px "Outfit", "Inter", sans-serif';
          const contactText = truncateText(`Direct Hotline: ${brandContact}`, width - 160);
          ctx.fillText(contactText, width / 2, height - 85);
        }
      }
    }

  }, [property, template, bgImageElement, showPrice, showCode, showLocation, showBranding, brandName, brandContact, currency]);

  // Redraw whenever parameters change
  useEffect(() => {
    if (open) {
      // Subtle delay to ensure fonts/DOM elements align
      const timer = setTimeout(() => {
        drawFlyer();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [open, drawFlyer]);

  const [savingToProperty, setSavingToProperty] = useState(false);

  const uploadFlyerToProperty = async (silent = false) => {
    const canvas = canvasRef.current;
    if (!canvas || !property) {
      console.error('[FlyerCreatorDialog] Canvas or property is missing');
      if (!silent) toast.error('Canvas or property not available');
      return;
    }

    if (!silent) setSavingToProperty(true);
    try {
      // 1. Convert canvas to Blob
      // canvas.toBlob() can silently hang on tainted canvases (cross-origin
      // images without proper CORS) — the callback simply never fires. We
      // guard against this with a timeout and a toDataURL fallback.
      console.log('[FlyerCreatorDialog] Converting canvas to blob...');
      const blob = await new Promise<Blob | null>((resolve) => {
        const timeout = setTimeout(() => {
          console.warn('[FlyerCreatorDialog] toBlob timed out after 10s — trying toDataURL fallback');
          try {
            const dataUrl = canvas.toDataURL('image/png');
            const byteString = atob(dataUrl.split(',')[1]);
            const mimeString = dataUrl.split(',')[0].split(':')[1].split(';')[0];
            const ab = new ArrayBuffer(byteString.length);
            const ia = new Uint8Array(ab);
            for (let i = 0; i < byteString.length; i++) {
              ia[i] = byteString.charCodeAt(i);
            }
            resolve(new Blob([ab], { type: mimeString }));
          } catch (fallbackErr) {
            console.error('[FlyerCreatorDialog] toDataURL fallback also failed (canvas tainted?):', fallbackErr);
            resolve(null);
          }
        }, 10000);

        try {
          canvas.toBlob((result) => {
            clearTimeout(timeout);
            resolve(result);
          }, 'image/png');
        } catch (err) {
          clearTimeout(timeout);
          console.error('[FlyerCreatorDialog] Canvas toBlob threw (tainted canvas):', err);
          // Synchronous SecurityError on tainted canvas — try toDataURL fallback
          try {
            const dataUrl = canvas.toDataURL('image/png');
            const byteString = atob(dataUrl.split(',')[1]);
            const mimeString = dataUrl.split(',')[0].split(':')[1].split(';')[0];
            const ab = new ArrayBuffer(byteString.length);
            const ia = new Uint8Array(ab);
            for (let i = 0; i < byteString.length; i++) {
              ia[i] = byteString.charCodeAt(i);
            }
            resolve(new Blob([ab], { type: mimeString }));
          } catch {
            resolve(null);
          }
        }
      });
      
      if (!blob) {
        throw new Error('Failed to generate image blob. The canvas may be tainted by a cross-origin image. Try using "Generate with AI" for the background instead.');
      }
      
      console.log('[FlyerCreatorDialog] Blob created, size:', blob.size);

      // 2. Upload blob to Supabase Storage
      const supabase = createClient();
      const randomStr = Math.random().toString(36).substring(2, 7);
      const path = `${property.account_id}/flyer-${Date.now()}-${randomStr}.png`;

      console.log('[FlyerCreatorDialog] Uploading to path:', path);
      const { error: uploadError } = await supabase.storage
        .from('property-images')
        .upload(path, blob, {
          cacheControl: '3600',
          upsert: true,
          contentType: 'image/png',
        });

      if (uploadError) {
        console.error('[FlyerCreatorDialog] Upload error:', uploadError);
        throw new Error(`Failed to upload flyer: ${uploadError.message}`);
      }
      
      console.log('[FlyerCreatorDialog] Upload successful');

      // 3. Store the bucket-relative object path
      const storedPath = `property-images/${path}`;

      // 4. Update the property's images in the database (placing flyer at index 0)
      const currentImages = property.images || [];
      const updatedImages = [storedPath, ...currentImages.filter(url => url !== storedPath)];

      console.log('[FlyerCreatorDialog] Updating property images...');
      const { error: updateError } = await supabase
        .from('properties')
        .update({ images: updatedImages, updated_at: new Date().toISOString() })
        .eq('id', property.id);

      if (updateError) {
        console.error('[FlyerCreatorDialog] Database update error:', updateError);
        throw new Error(`Failed to save flyer url to property: ${updateError.message}`);
      }
      
      console.log('[FlyerCreatorDialog] Property updated successfully');

      if (!silent) {
        toast.success('Flyer saved successfully as the default property photo!');
        setImageSource('original');
      } else {
        console.log('[FlyerCreatorDialog] Flyer auto-saved to property images');
      }
      
      // Invoke callback to refresh properties on the dashboard
      if (onSaved) {
        onSaved();
      }
    } catch (err) {
      console.error('[FlyerCreatorDialog] Error saving flyer to property:', err);
      if (!silent) {
        const message = err instanceof Error ? err.message : 'Failed to save flyer to property.';
        toast.error(message);
      }
    } finally {
      if (!silent) setSavingToProperty(false);
    }
  };

  // Handle PNG Flyer download
  const handleDownload = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    try {
      const link = document.createElement('a');
      link.download = `${property?.property_code || 'flyer'}_AI_marketing_flyer.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      toast.success('AI Marketing Flyer downloaded successfully!');
      
      // Auto-save the flyer to property images by default
      await uploadFlyerToProperty(true);
    } catch (err) {
      console.error(err);
      toast.error('Download failed. Supabase storage bucket CORS headers might be blocking canvas operations. Try using an AI generated image.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900 border-slate-700 text-slate-200 sm:max-w-4xl max-h-[92vh] flex flex-col min-h-0 overflow-hidden p-6 gap-0">
        <DialogHeader className="mb-4 shrink-0">
          <DialogTitle className="text-white flex items-center gap-2 text-xl font-black">
            <Sparkles className="size-5 text-primary animate-pulse" />
            AI-Powered Flyer Creator
          </DialogTitle>
          <DialogDescription className="text-slate-400 text-xs mt-0.5">
            Modify backgrounds with AI text-to-image prompts and overlay listing details to make premium marketing graphics.
          </DialogDescription>
        </DialogHeader>

        {/* Modal Main Panel */}
        <div className="flex-1 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-6 min-h-0 pr-1 pb-4">
          
          {/* LEFT: Live Preview Canvas */}
          <div className="flex flex-col items-center justify-center bg-slate-950 border border-slate-800 rounded-xl p-4 self-start">
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2.5">Live Design Preview (1080x1080)</span>
            <div className="relative w-full max-w-[340px] aspect-square bg-slate-900 border border-slate-800 rounded-lg overflow-hidden shadow-inner flex items-center justify-center">
              <canvas
                ref={canvasRef}
                className="w-full h-full object-contain"
                style={{ aspectRatio: '1/1' }}
              />
              {generatingAiImage && (
                <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm flex flex-col items-center justify-center text-center p-6 gap-3 select-none">
                  <PropertyBlueprintLoader size={56} label="Generating your image" />
                  <p className="text-sm font-bold text-white">Google AI is generating your image...</p>
                  <p className="text-xs text-slate-400">Usually takes 4-7 seconds. Please wait.</p>
                </div>
              )}
            </div>
            <div className="text-[10px] text-slate-500 text-center mt-3 max-w-[320px]">
              Tip: AI-generated listing photos bypass browser CORS limitations, ensuring smooth downloading at all times.
            </div>
          </div>

          {/* RIGHT: Flyer Settings Controls */}
          <div className="space-y-4 pr-1">
            
            {/* Image Source Selection */}
            <div className="space-y-2">
              <Label className="text-xs font-bold text-slate-350">Listing Image Background</Label>
              <div className="grid grid-cols-2 gap-2 p-1 bg-slate-950 rounded-lg border border-slate-800">
                <button
                  type="button"
                  onClick={() => setImageSource('original')}
                  disabled={!property?.images || property.images.length === 0}
                  className={`py-1.5 rounded-md text-xs font-bold transition-all cursor-pointer ${
                    imageSource === 'original'
                      ? 'bg-slate-800 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 disabled:opacity-30'
                  }`}
                >
                  Original Photo
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (aiImageUrl) setImageSource('ai');
                    else handleGenerateAIImage();
                  }}
                  className={`py-1.5 rounded-md text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1 ${
                    imageSource === 'ai'
                      ? 'bg-slate-800 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Sparkles className="size-3 text-primary" />
                  {aiImageUrl ? 'AI Generated' : 'Generate with AI'}
                  {!aiImageUrl && (
                    <span className="text-[9px] text-slate-500 font-normal">({AI_FEATURE_COSTS.image_enhance} cr)</span>
                  )}
                </button>
              </div>
            </div>

            {/* AI Generator prompt panel */}
            {(imageSource === 'ai' || !bgImageElement) && (
              <div className="bg-slate-950/40 border border-slate-800 p-3 rounded-lg space-y-2.5 animate-fade-in">
                <div className="flex items-center justify-between">
                  <Label htmlFor="ai-prompt-input" className="text-xs font-semibold text-primary">
                    AI Text-to-Image Prompt (Google AI)
                  </Label>
                  <Button
                    size="xs"
                    onClick={handleGenerateAIImage}
                    disabled={generatingAiImage}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground h-6 text-[10px] font-bold py-0 cursor-pointer flex items-center gap-1"
                  >
                    {generatingAiImage ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                    Regenerate ({AI_FEATURE_COSTS.image_enhance} cr)
                  </Button>
                </div>
                <Textarea
                  id="ai-prompt-input"
                  rows={3}
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  className="bg-slate-800 border-slate-700 text-xs text-white placeholder:text-slate-500 rounded-md focus:ring-0 focus:border-slate-600 focus:outline-none"
                  placeholder="Describe the background image details..."
                />
              </div>
            )}

            {/* Template overlay style selector */}
            <div className="space-y-1.5">
              <Label htmlFor="flyer-template" className="text-xs font-bold text-slate-350">Overlay Template Style</Label>
              <select
                id="flyer-template"
                value={template}
                onChange={(e) => setTemplate(e.target.value as TemplateStyle)}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white focus:border-primary focus:outline-none font-medium"
              >
                <option value="minimalist">Modern Minimalist Gradient</option>
                <option value="glassmorphism">Floating Frosted Glass Card</option>
                <option value="vignette">Radial Dark Vignette Frame</option>
              </select>
            </div>

            {/* Display visibility toggles */}
            <div className="space-y-2 bg-slate-950/20 border border-slate-850 p-3.5 rounded-xl">
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block mb-2">Configure Overlay Details</span>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none hover:text-white transition-all">
                  <input
                    type="checkbox"
                    checked={showPrice}
                    onChange={(e) => setShowPrice(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-900 text-primary focus:ring-0 h-4 w-4"
                  />
                  Show Listing Price
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none hover:text-white transition-all">
                  <input
                    type="checkbox"
                    checked={showCode}
                    onChange={(e) => setShowCode(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-900 text-primary focus:ring-0 h-4 w-4"
                  />
                  Show Unique ID
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none hover:text-white transition-all">
                  <input
                    type="checkbox"
                    checked={showLocation}
                    onChange={(e) => setShowLocation(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-900 text-primary focus:ring-0 h-4 w-4"
                  />
                  Show Full Location
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none hover:text-white transition-all">
                  <input
                    type="checkbox"
                    checked={showBranding}
                    onChange={(e) => setShowBranding(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-900 text-primary focus:ring-0 h-4 w-4"
                  />
                  Show Agent Branding
                </label>
              </div>
            </div>

            {/* Agent / Brand details custom overlay editor */}
            {showBranding && (
              <div className="grid grid-cols-2 gap-3 p-3 bg-slate-950/20 border border-slate-850 rounded-xl animate-fade-in">
                <div className="space-y-1">
                  <Label htmlFor="brand-name-input" className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Company Brand Name</Label>
                  <Input
                    id="brand-name-input"
                    value={brandName}
                    onChange={(e) => setBrandName(e.target.value)}
                    className="bg-slate-800 border-slate-700 text-white h-7 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="brand-contact-input" className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Agent Phone Callout</Label>
                  <Input
                    id="brand-contact-input"
                    value={brandContact}
                    onChange={(e) => setBrandContact(e.target.value)}
                    className="bg-slate-800 border-slate-700 text-white h-7 text-xs"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer Controls */}
        <DialogFooter className="bg-slate-900 border-slate-700 pt-3 border-t shrink-0 flex items-center justify-end w-full">
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={savingToProperty}
              onClick={() => uploadFlyerToProperty(false)}
              className="border-primary text-primary hover:bg-primary/10 font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              {savingToProperty ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              Save to Property Photos
            </Button>
            <Button
              type="button"
              disabled={savingToProperty}
              onClick={handleDownload}
              className="bg-primary hover:bg-primary/95 text-primary-foreground font-semibold flex items-center gap-1.5"
            >
              <Download className="size-4" />
              Download Flyer
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
