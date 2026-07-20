'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FolderInput, Loader2 } from 'lucide-react';

interface ImportSharedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

export function ImportSharedDialog({ open, onOpenChange, onImported }: ImportSharedDialogProps) {
  const [link, setLink] = useState('');
  const [importing, setImporting] = useState(false);

  async function handleImport() {
    if (!link.trim()) return;
    setImporting(true);
    try {
      const res = await fetch('/api/inventory/import-shared', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: link.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to import property');
      if (data.data?.alreadyImported) {
        toast.info('This property is already in your inventory');
      } else {
        toast.success('Property imported — review and publish it when ready');
      }
      setLink('');
      onOpenChange(false);
      onImported();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to import property');
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900 border-slate-700 text-slate-200 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <FolderInput className="size-5 text-primary" />
            Import Shared Property
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Paste a property link another agent shared with you. The listing is copied into
            your inventory as agent-referred, credits them as the source, and stays
            unpublished until you review it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="import-share-link" className="text-slate-300">
            Shared property link
          </Label>
          <Input
            id="import-share-link"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://.../?property_id=..."
            className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleImport();
            }}
          />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800"
          >
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            disabled={importing || !link.trim()}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {importing ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Importing...
              </>
            ) : (
              'Import'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
