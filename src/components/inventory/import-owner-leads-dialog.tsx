'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { RefreshCw, Loader2, Users, Download, Trash2, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PORTALS, type PortalKey } from '@/lib/portals/post-kit';

interface OwnerLead {
  id: string;
  portal: PortalKey;
  url: string;
  title: string;
  price: string;
  name: string;
  phone: string;
  capturedAt: number;
}

interface ImportOwnerLeadsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported?: () => void;
}

export function ImportOwnerLeadsDialog({ open, onOpenChange, onImported }: ImportOwnerLeadsDialogProps) {
  const [extensionDetected, setExtensionDetected] = useState(false);
  const [leads, setLeads] = useState<OwnerLead[]>([]);
  const [pulling, setPulling] = useState(false);
  const [importing, setImporting] = useState(false);

  const pullFromExtension = useCallback(() => {
    setPulling(true);
    window.postMessage({ type: 'CONVOREAL_OWNER_LEADS_PULL' }, window.location.origin);
    setTimeout(() => setPulling(false), 1500);
  }, []);

  const clearExtensionData = useCallback(() => {
    window.postMessage({ type: 'CONVOREAL_OWNER_LEADS_CLEAR' }, window.location.origin);
    setLeads([]);
  }, []);

  useEffect(() => {
    if (!open || typeof window === 'undefined') return;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; leads?: OwnerLead[] } | null;
      if (data?.type === 'CONVOREAL_PORTAL_EXT_PONG') {
        setExtensionDetected(true);
      } else if (data?.type === 'CONVOREAL_OWNER_LEADS_DATA') {
        setExtensionDetected(true);
        setPulling(false);
        setLeads(data.leads || []);
      } else if (data?.type === 'CONVOREAL_OWNER_LEADS_CLEARED') {
        setExtensionDetected(true);
        setLeads([]);
      }
    };
    window.addEventListener('message', onMessage);
    window.postMessage({ type: 'CONVOREAL_PORTAL_EXT_PING' }, window.location.origin);
    pullFromExtension();
    return () => window.removeEventListener('message', onMessage);
  }, [open, pullFromExtension]);

  const handleImport = async () => {
    if (leads.length === 0) return;
    setImporting(true);
    try {
      const res = await fetch('/api/inventory/import-owner-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leads }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to import leads');
      
      toast.success(`Successfully imported ${json.count} owner leads`);
      clearExtensionData();
      onOpenChange(false);
      if (onImported) onImported();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col bg-slate-900 text-slate-200 p-0 overflow-hidden border-slate-700">
        <DialogHeader className="px-6 py-4 border-b border-slate-800 shrink-0 bg-slate-900/50">
          <DialogTitle className="flex items-center gap-2 text-lg font-semibold text-slate-100">
            <Users className="size-5 text-indigo-400" />
            Import Owner Leads
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Leads captured directly from property portals using the ConvoReal extension.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {!extensionDetected ? (
            <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-slate-800 bg-slate-900/50 py-12 text-center text-slate-400">
              <RefreshCw className="size-8 text-slate-600" />
              <div className="space-y-1">
                <p className="font-semibold text-slate-300">Extension not detected</p>
                <p className="max-w-md text-sm">
                  Please install or enable the ConvoReal Chrome extension to capture leads from portals.
                </p>
              </div>
            </div>
          ) : leads.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-slate-800 bg-slate-900/50 py-12 text-center text-slate-400">
              {pulling ? (
                <>
                  <Loader2 className="size-8 animate-spin text-indigo-500" />
                  <p className="font-medium text-slate-300">Checking for captured leads...</p>
                </>
              ) : (
                <>
                  <CheckCircle2 className="size-8 text-emerald-500" />
                  <div className="space-y-1">
                    <p className="font-semibold text-slate-300">No leads waiting</p>
                    <p className="max-w-md text-sm">
                      Go to a portal, reveal an owner&apos;s contact number, and use the extension to capture them.
                    </p>
                  </div>
                  <Button variant="outline" onClick={pullFromExtension} className="mt-2 text-xs h-8 border-slate-700 bg-slate-800">
                    <RefreshCw className="mr-2 size-3" /> Check again
                  </Button>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-slate-300">
                  {leads.length} {leads.length === 1 ? 'Lead' : 'Leads'} ready to import
                </h3>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={pullFromExtension} disabled={pulling || importing} className="h-8 px-2 text-slate-400">
                    <RefreshCw className={cn('size-4', pulling && 'animate-spin')} />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={clearExtensionData} disabled={importing} className="h-8 text-xs text-red-400 hover:text-red-300 hover:bg-red-400/10">
                    <Trash2 className="mr-1.5 size-3.5" /> Clear Queue
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border border-slate-800 divide-y divide-slate-800">
                {leads.map((lead) => (
                  <div key={lead.id} className="p-3 bg-slate-900/40 hover:bg-slate-800/50 flex flex-col gap-2 transition-colors">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-200">{lead.name}</span>
                        <span className="text-slate-400 text-sm">{lead.phone}</span>
                      </div>
                      <span className="text-xs font-medium px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                        {PORTALS[lead.portal]?.label || lead.portal}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 truncate max-w-full">
                      {lead.title}
                    </div>
                    {lead.price && (
                      <div className="text-xs font-medium text-emerald-400">
                        {lead.price}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-800 bg-slate-950 p-4 shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importing} className="border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700">
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            disabled={!extensionDetected || leads.length === 0 || importing}
            className="bg-indigo-600 hover:bg-indigo-500 text-white min-w-[120px]"
          >
            {importing ? (
              <><Loader2 className="mr-2 size-4 animate-spin" /> Importing...</>
            ) : (
              <><Download className="mr-2 size-4" /> Import {leads.length}</>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
