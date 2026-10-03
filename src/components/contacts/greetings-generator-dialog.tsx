'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Loader2, Copy, Share2, MessageSquare, Download } from 'lucide-react';

interface GreetingsGeneratorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  contactName: string;
  contactPhone: string;
}

const PRESET_OCCASIONS = [
  { name: 'New Year', emoji: '✨' },
  { name: 'Ganesh Chaturthi', emoji: '🕉️' },
  { name: 'Christmas', emoji: '🎄' },
  { name: 'Birthday', emoji: '🎂' },
];

export function GreetingsGeneratorDialog({
  open,
  onOpenChange,
  contactId,
  contactName,
  contactPhone,
}: GreetingsGeneratorDialogProps) {
  const supabase = createClient();
  const { user, accountId } = useAuth();

  const [selectedOccasion, setSelectedOccasion] = useState('New Year');
  const [customOccasion, setCustomOccasion] = useState('');
  const [generateImage, setGenerateImage] = useState(true);
  const [generating, setGenerating] = useState(false);

  const [generatedText, setGeneratedText] = useState('');
  const [generatedImageUrl, setGeneratedImageUrl] = useState('');

  // Reset when dialog opens
  useEffect(() => {
    if (open) {
      setGeneratedText('');
      setGeneratedImageUrl('');
      setGenerating(false);
    }
  }, [open]);

  const handleGenerate = async () => {
    const finalOccasion =
      selectedOccasion === 'Custom' ? customOccasion : selectedOccasion;
    if (!finalOccasion.trim()) {
      toast.error('Please select or specify an occasion.');
      return;
    }

    setGenerating(true);
    setGeneratedText('');
    setGeneratedImageUrl('');

    try {
      const res = await fetch('/api/ai/greetings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          occasion: finalOccasion,
          contactName,
          generateImage,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to generate greetings');
      }

      const data = await res.json();
      setGeneratedText(data.text);
      if (data.imageUrl) {
        setGeneratedImageUrl(data.imageUrl);
      }
      toast.success('AI Greeting generated successfully!');
    } catch (err) {
      console.error(err);
      toast.error(
        err instanceof Error ? err.message : 'Error generating greeting'
      );
    } finally {
      setGenerating(false);
    }
  };

  const handleWhatsAppShare = async () => {
    if (!generatedText) return;

    // Log the interaction
    try {
      await supabase.from('contact_notes').insert({
        contact_id: contactId,
        account_id: accountId,
        user_id: user?.id,
        note_text: `Sent AI Greeting (${selectedOccasion === 'Custom' ? customOccasion : selectedOccasion}) via WhatsApp:\n\n"${generatedText}"`,
      });
    } catch (logErr) {
      console.error('Failed to log greeting share:', logErr);
    }

    const text = encodeURIComponent(generatedText);
    const url = `https://wa.me/${contactPhone.replace(/\D/g, '')}?text=${text}`;
    window.open(url, '_blank');
  };

  const handleCopy = () => {
    if (!generatedText) return;
    navigator.clipboard.writeText(generatedText);
    toast.success('Copied text greeting to clipboard!');
  };

  const handleDownload = () => {
    if (!generatedImageUrl) return;
    const link = document.createElement('a');
    link.href = generatedImageUrl;
    link.download = `${contactName.replace(/\s+/g, '_')}_${selectedOccasion.replace(/\s+/g, '_')}_card.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('Festive card downloaded successfully!');
  };

  const handleNativeShare = async () => {
    if (!generatedText) return;

    try {
      const shareData: ShareData = {
        title: `Greeting for ${contactName}`,
        text: generatedText,
      };

      if (generatedImageUrl) {
        // Convert base64 to File object if supported
        const blob = await fetch(generatedImageUrl).then((res) => res.blob());
        const file = new File([blob], 'festive-card.jpg', {
          type: 'image/jpeg',
        });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          shareData.files = [file];
        }
      }

      await navigator.share(shareData);
      toast.success('Shared successfully!');
    } catch (err) {
      console.error(err);
      // Don't toast error if user cancelled the share sheet
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900 p-6 text-white shadow-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-bold">
            <span>🎉</span> AI Greetings &amp; Cards Generator
          </DialogTitle>
          <DialogDescription className="mt-1 text-xs text-slate-400">
            Generate warm personal greetings using Gemini and beautiful festive
            graphics using Hugging Face.
          </DialogDescription>
        </DialogHeader>

        {!generatedText && !generating ? (
          <div className="mt-4 space-y-5">
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-slate-300">
                Select Occasion
              </Label>
              <div className="grid grid-cols-2 gap-2">
                {PRESET_OCCASIONS.map((preset) => (
                  <button
                    key={preset.name}
                    type="button"
                    onClick={() => setSelectedOccasion(preset.name)}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-xs font-semibold transition-all ${
                      selectedOccasion === preset.name
                        ? 'border-rose-500 bg-rose-500/10 text-rose-400 shadow-sm'
                        : 'border-slate-800 bg-slate-800/40 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <span>{preset.emoji}</span>
                    <span>{preset.name}</span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setSelectedOccasion('Custom')}
                  className={`col-span-2 flex cursor-pointer items-center justify-center gap-2 rounded-lg border p-2.5 text-xs font-semibold transition-all ${
                    selectedOccasion === 'Custom'
                      ? 'border-rose-500 bg-rose-500/10 text-rose-400 shadow-sm'
                      : 'border-slate-800 bg-slate-800/40 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  ⚙️ Custom Occasion
                </button>
              </div>
            </div>

            {selectedOccasion === 'Custom' && (
              <div className="animate-in fade-in slide-in-from-top-1 space-y-2 duration-200">
                <Label
                  htmlFor="custom-occasion"
                  className="text-xs text-slate-300"
                >
                  Specify Occasion
                </Label>
                <Input
                  id="custom-occasion"
                  placeholder="e.g., Happy Diwali, Anniversary..."
                  value={customOccasion}
                  onChange={(e) => setCustomOccasion(e.target.value)}
                  className="border-slate-700 bg-slate-800 text-xs text-white placeholder:text-slate-500"
                />
              </div>
            )}

            <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/40 p-3">
              <div className="space-y-0.5">
                <Label
                  htmlFor="gen-image"
                  className="cursor-pointer text-xs font-semibold text-slate-200"
                >
                  Generate Graphic Card
                </Label>
                <p className="text-[10px] leading-none text-slate-500">
                  Create a matching festive image card
                </p>
              </div>
              <input
                id="gen-image"
                type="checkbox"
                checked={generateImage}
                onChange={(e) => setGenerateImage(e.target.checked)}
                className="size-4 cursor-pointer rounded border-slate-700 bg-slate-800 text-rose-500 accent-rose-500"
              />
            </div>

            <div className="border-slate-850 flex items-center gap-2 rounded-xl border bg-slate-950/60 p-3 text-[10px] text-slate-400">
              <span>💡</span>
              <span>
                This operation consumes <strong>10 credits</strong> from your
                wallet.
              </span>
            </div>

            <Button
              type="button"
              onClick={handleGenerate}
              className="h-10 w-full cursor-pointer rounded-xl bg-rose-500 font-bold text-white shadow-lg shadow-rose-500/10 transition-all hover:bg-rose-600"
            >
              Generate AI Greeting
            </Button>
          </div>
        ) : generating ? (
          <div className="mt-4 flex flex-col items-center justify-center gap-3 py-16">
            <Loader2 className="size-8 animate-spin text-rose-500" />
            <div className="text-center">
              <p className="text-sm font-semibold text-slate-200">
                Generating creative assets...
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                Personalizing text greeting and rendering design cards
              </p>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-5">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-300">
                Message Preview
              </Label>
              <Textarea
                value={generatedText}
                onChange={(e) => setGeneratedText(e.target.value)}
                className="min-h-[100px] resize-none border-slate-700 bg-slate-800 text-xs leading-relaxed text-slate-100 focus-visible:border-rose-500 focus-visible:ring-1 focus-visible:ring-rose-500"
              />
            </div>

            {generatedImageUrl && (
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-slate-300">
                  Graphic Card Card
                </Label>
                <div className="group relative flex aspect-video items-center justify-center overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={generatedImageUrl}
                    alt="Festive greeting card"
                    className="h-full w-full object-contain"
                  />
                  <div className="absolute inset-0 flex items-center justify-center gap-2 bg-slate-950/60 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleDownload}
                      className="h-8 gap-1.5 border-slate-700 bg-slate-900 text-[11px] text-white hover:bg-slate-800"
                    >
                      <Download className="size-3.5" />
                      Download Card
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 pt-2">
              <Button
                variant="outline"
                onClick={handleCopy}
                className="h-9 gap-1.5 rounded-lg border-slate-800 text-xs font-semibold text-slate-300 hover:bg-slate-800"
              >
                <Copy className="size-3.5" />
                Copy Greeting
              </Button>
              {typeof navigator.share !== 'undefined' ? (
                <Button
                  variant="outline"
                  onClick={handleNativeShare}
                  className="h-9 gap-1.5 rounded-lg border-slate-800 text-xs font-semibold text-slate-300 hover:bg-slate-800"
                >
                  <Share2 className="size-3.5" />
                  Share System
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={handleDownload}
                  disabled={!generatedImageUrl}
                  className="h-9 gap-1.5 rounded-lg border-slate-800 text-xs font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                >
                  <Download className="size-3.5" />
                  Download Card
                </Button>
              )}
              <Button
                onClick={handleWhatsAppShare}
                className="col-span-2 h-10 cursor-pointer gap-2 rounded-xl bg-emerald-500 font-bold text-slate-950 shadow-lg shadow-emerald-500/10 transition-all hover:bg-emerald-600"
              >
                <MessageSquare className="size-4 fill-slate-950" />
                Send Greeting via WhatsApp
              </Button>
            </div>

            <Button
              variant="ghost"
              onClick={() => {
                setGeneratedText('');
                setGeneratedImageUrl('');
              }}
              className="h-8 w-full cursor-pointer text-xs text-slate-500 hover:text-slate-400"
            >
              ← Back / Generate Another
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
