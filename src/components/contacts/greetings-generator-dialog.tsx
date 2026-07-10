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
  const { user } = useAuth();

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
    const finalOccasion = selectedOccasion === 'Custom' ? customOccasion : selectedOccasion;
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
      toast.error(err instanceof Error ? err.message : 'Error generating greeting');
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
        user_id: user?.id,
        content: `Sent AI Greeting (${selectedOccasion === 'Custom' ? customOccasion : selectedOccasion}) via WhatsApp:\n\n"${generatedText}"`,
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
        const file = new File([blob], 'festive-card.jpg', { type: 'image/jpeg' });
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
      <DialogContent className="max-w-md bg-slate-900 border border-slate-800 text-white rounded-2xl shadow-2xl p-6 overflow-y-auto max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <span>🎉</span> AI Greetings &amp; Cards Generator
          </DialogTitle>
          <DialogDescription className="text-slate-400 text-xs mt-1">
            Generate warm personal greetings using Gemini and beautiful festive graphics using Hugging Face.
          </DialogDescription>
        </DialogHeader>

        {!generatedText && !generating ? (
          <div className="space-y-5 mt-4">
            <div className="space-y-2">
              <Label className="text-slate-300 text-xs font-semibold">Select Occasion</Label>
              <div className="grid grid-cols-2 gap-2">
                {PRESET_OCCASIONS.map((preset) => (
                  <button
                    key={preset.name}
                    type="button"
                    onClick={() => setSelectedOccasion(preset.name)}
                    className={`flex items-center gap-2 p-2.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
                      selectedOccasion === preset.name
                        ? 'bg-rose-500/10 border-rose-500 text-rose-400 shadow-sm'
                        : 'bg-slate-800/40 border-slate-800 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <span>{preset.emoji}</span>
                    <span>{preset.name}</span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setSelectedOccasion('Custom')}
                  className={`col-span-2 flex items-center justify-center gap-2 p-2.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
                    selectedOccasion === 'Custom'
                      ? 'bg-rose-500/10 border-rose-500 text-rose-400 shadow-sm'
                      : 'bg-slate-800/40 border-slate-800 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  ⚙️ Custom Occasion
                </button>
              </div>
            </div>

            {selectedOccasion === 'Custom' && (
              <div className="space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
                <Label htmlFor="custom-occasion" className="text-slate-300 text-xs">Specify Occasion</Label>
                <Input
                  id="custom-occasion"
                  placeholder="e.g., Happy Diwali, Anniversary..."
                  value={customOccasion}
                  onChange={(e) => setCustomOccasion(e.target.value)}
                  className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 text-xs"
                />
              </div>
            )}

            <div className="flex items-center justify-between p-3 bg-slate-950/40 border border-slate-800 rounded-xl">
              <div className="space-y-0.5">
                <Label htmlFor="gen-image" className="text-slate-200 text-xs font-semibold cursor-pointer">
                  Generate Graphic Card
                </Label>
                <p className="text-[10px] text-slate-500 leading-none">Create a matching festive image card</p>
              </div>
              <input
                id="gen-image"
                type="checkbox"
                checked={generateImage}
                onChange={(e) => setGenerateImage(e.target.checked)}
                className="size-4 rounded accent-rose-500 border-slate-700 bg-slate-800 text-rose-500 cursor-pointer"
              />
            </div>

            <div className="bg-slate-950/60 rounded-xl p-3 border border-slate-850 text-slate-400 text-[10px] flex items-center gap-2">
              <span>💡</span>
              <span>This operation consumes <strong>10 credits</strong> from your wallet.</span>
            </div>

            <Button
              type="button"
              onClick={handleGenerate}
              className="w-full bg-rose-500 hover:bg-rose-600 text-white font-bold h-10 rounded-xl shadow-lg shadow-rose-500/10 cursor-pointer transition-all"
            >
              Generate AI Greeting
            </Button>
          </div>
        ) : generating ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 mt-4">
            <Loader2 className="size-8 animate-spin text-rose-500" />
            <div className="text-center">
              <p className="text-sm font-semibold text-slate-200">Generating creative assets...</p>
              <p className="text-[11px] text-slate-500 mt-1">Personalizing text greeting and rendering design cards</p>
            </div>
          </div>
        ) : (
          <div className="space-y-5 mt-4">
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs font-semibold">Message Preview</Label>
              <Textarea
                value={generatedText}
                onChange={(e) => setGeneratedText(e.target.value)}
                className="bg-slate-800 border-slate-700 text-slate-100 text-xs min-h-[100px] leading-relaxed resize-none focus-visible:ring-1 focus-visible:ring-rose-500 focus-visible:border-rose-500"
              />
            </div>

            {generatedImageUrl && (
              <div className="space-y-2">
                <Label className="text-slate-300 text-xs font-semibold">Graphic Card Card</Label>
                <div className="relative group border border-slate-800 rounded-xl overflow-hidden bg-slate-950 aspect-video flex items-center justify-center">
                  <img
                    src={generatedImageUrl}
                    alt="Festive greeting card"
                    className="object-contain w-full h-full"
                  />
                  <div className="absolute inset-0 bg-slate-950/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleDownload}
                      className="border-slate-700 bg-slate-900 text-white hover:bg-slate-800 gap-1.5 h-8 text-[11px]"
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
                className="border-slate-800 hover:bg-slate-800 text-slate-300 font-semibold gap-1.5 h-9 rounded-lg text-xs"
              >
                <Copy className="size-3.5" />
                Copy Greeting
              </Button>
              {typeof navigator.share !== 'undefined' ? (
                <Button
                  variant="outline"
                  onClick={handleNativeShare}
                  className="border-slate-800 hover:bg-slate-800 text-slate-300 font-semibold gap-1.5 h-9 rounded-lg text-xs"
                >
                  <Share2 className="size-3.5" />
                  Share System
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={handleDownload}
                  disabled={!generatedImageUrl}
                  className="border-slate-800 hover:bg-slate-800 text-slate-300 font-semibold gap-1.5 h-9 rounded-lg text-xs disabled:opacity-50"
                >
                  <Download className="size-3.5" />
                  Download Card
                </Button>
              )}
              <Button
                onClick={handleWhatsAppShare}
                className="col-span-2 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold gap-2 h-10 rounded-xl transition-all shadow-lg shadow-emerald-500/10 cursor-pointer"
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
              className="w-full text-slate-500 hover:text-slate-400 text-xs h-8 cursor-pointer"
            >
              ← Back / Generate Another
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
