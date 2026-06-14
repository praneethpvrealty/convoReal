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
import {
  Sparkles,
  Download,
  Loader2,
  RefreshCw,
} from 'lucide-react';

interface FlyerCreatorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  property: Property | null;
}

type TemplateStyle = 'minimalist' | 'glassmorphism' | 'vignette';

export function FlyerCreatorDialog({
  open,
  onOpenChange,
  property,
}: FlyerCreatorDialogProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { user } = useAuth();

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
  const [brandName, setBrandName] = useState('Aryavarta Ventures');
  const [brandContact, setBrandContact] = useState('');

  // Image loading caches to avoid reloading during simple toggle modifications
  const [bgImageElement, setBgImageElement] = useState<HTMLImageElement | null>(null);

  // Prefill defaults on open
  useEffect(() => {
    if (open && property) {
      const hasOriginal = property.images && property.images.length > 0;
      setImageSource(hasOriginal ? 'original' : 'ai');
      
      setAiPrompt(
        `A high-end, professional architectural photograph of a luxury ${property.type.toLowerCase()} in ${property.sublocality || property.city || 'Bangalore'}, clean composition, beautiful morning sunlight, modern real estate marketing photography style`
      );

      // Default brand details
      setBrandName('Aryavarta Ventures');
      setBrandContact(user?.phone || '');
      setAiImageUrl(null);
      setBgImageElement(null);
    }
  }, [open, property, user]);

  // Generate image using Imagen 3 model
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
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
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
      ? property.images[0] 
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
      if (amount >= 10000000) {
        const cr = amount / 10000000;
        return `₹${cr.toFixed(2).replace(/\.00$/, '')} Cr`;
      } else if (amount >= 100000) {
        const lakhs = amount / 100000;
        return `₹${lakhs.toFixed(2).replace(/\.00$/, '')} Lakhs`;
      }
      return `₹${amount.toLocaleString('en-IN')}`;
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

      // TITLE & CATEGORY (Left side)
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 44px "Outfit", "Inter", sans-serif';
      // Truncate title if extremely long
      let titleLine = property.title;
      if (ctx.measureText(titleLine).width > 600) {
        titleLine = titleLine.slice(0, 30) + '...';
      }
      ctx.fillText(titleLine, 48, height - 210);

      // LOCATION (Left bottom)
      if (showLocation) {
        ctx.fillStyle = '#94a3b8'; // Muted slate text
        ctx.font = '600 28px "Outfit", "Inter", sans-serif';
        ctx.fillText(`📍 ${property.location}`, 48, height - 150);
      }

      // PRICE BADGE (Right side)
      if (showPrice) {
        const priceLabel = formatPrice(property.price);
        ctx.font = 'bold 48px "Outfit", "Inter", sans-serif';
        const priceW = ctx.measureText(priceLabel).width;
        const priceBadgeW = priceW + 40;
        
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
        ctx.fillText(brandName, 48, height - 45);

        if (brandContact) {
          ctx.fillStyle = '#f8fafc';
          ctx.textAlign = 'right';
          ctx.fillText(`📞 ${brandContact}`, width - 48, height - 45);
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

      // TITLE
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 42px "Outfit", "Inter", sans-serif';
      let titleLine = property.title;
      if (ctx.measureText(titleLine).width > 540) {
        titleLine = titleLine.slice(0, 28) + '...';
      }
      ctx.fillText(titleLine, cardX + 36, cardY + 36);

      // LOCATION
      if (showLocation) {
        ctx.fillStyle = '#cbd5e1';
        ctx.font = '500 24px "Outfit", "Inter", sans-serif';
        ctx.fillText(`📍 ${property.location}`, cardX + 36, cardY + 100);
      }

      // PRICE
      if (showPrice) {
        const priceLabel = formatPrice(property.price);
        ctx.fillStyle = '#34d399'; // Mint green
        ctx.font = 'bold 44px "Outfit", "Inter", sans-serif';
        ctx.textAlign = 'right';
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
        ctx.fillText(brandName, cardX + 36, cardY + 184);

        if (brandContact) {
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'right';
          ctx.fillText(`Contact: ${brandContact}`, cardX + cardW - 36, cardY + 184);
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
      ctx.fillText(property.title, width / 2, height / 2 - 120);

      // CATEGORY
      ctx.fillStyle = '#fbbf24'; // Amber Gold
      ctx.font = 'bold 28px "Outfit", "Inter", sans-serif';
      ctx.fillText(`★   ${property.type.toUpperCase()}   ★`, width / 2, height / 2 - 50);

      // PRICE
      if (showPrice) {
        ctx.fillStyle = '#ffffff';
        ctx.font = '800 68px "Outfit", "Inter", sans-serif';
        ctx.fillText(formatPrice(property.price), width / 2, height / 2 + 50);
      }

      // LOCATION
      if (showLocation) {
        ctx.fillStyle = '#cbd5e1';
        ctx.font = '500 28px "Outfit", "Inter", sans-serif';
        ctx.fillText(`📍 ${property.location}`, width / 2, height / 2 + 130);
      }

      // BRANDING
      if (showBranding) {
        ctx.fillStyle = '#f59e0b';
        ctx.font = 'bold 26px "Outfit", "Inter", sans-serif';
        ctx.fillText(brandName, width / 2, height - 130);

        if (brandContact) {
          ctx.fillStyle = '#ffffff';
          ctx.font = '600 24px "Outfit", "Inter", sans-serif';
          ctx.fillText(`Direct Hotline: ${brandContact}`, width / 2, height - 85);
        }
      }
    }

  }, [property, template, bgImageElement, showPrice, showCode, showLocation, showBranding, brandName, brandContact]);

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

  // Handle PNG Flyer download
  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    try {
      const link = document.createElement('a');
      link.download = `${property?.property_code || 'flyer'}_AI_marketing_flyer.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      toast.success('AI Marketing Flyer downloaded successfully!');
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
                  <RefreshCw className="size-8 animate-spin text-primary" />
                  <p className="text-sm font-bold text-white">Imagen 3 is generating your image...</p>
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
                </button>
              </div>
            </div>

            {/* AI Generator prompt panel */}
            {(imageSource === 'ai' || !bgImageElement) && (
              <div className="bg-slate-950/40 border border-slate-800 p-3 rounded-lg space-y-2.5 animate-fade-in">
                <div className="flex items-center justify-between">
                  <Label htmlFor="ai-prompt-input" className="text-xs font-semibold text-primary">
                    AI Text-to-Image Prompt (Imagen 3)
                  </Label>
                  <Button
                    size="xs"
                    onClick={handleGenerateAIImage}
                    disabled={generatingAiImage}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground h-6 text-[10px] font-bold py-0 cursor-pointer flex items-center gap-1"
                  >
                    {generatingAiImage ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                    Regenerate
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
        <DialogFooter className="bg-slate-900 border-slate-700 pt-3 border-t shrink-0 flex items-center justify-between sm:justify-between w-full">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-slate-700 text-slate-300 hover:bg-slate-800"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleDownload}
            className="bg-primary hover:bg-primary/95 text-primary-foreground font-semibold flex items-center gap-1.5"
          >
            <Download className="size-4" />
            Download Flyer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
