'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, CalendarDays } from 'lucide-react';

interface SimpleContact {
  id: string;
  name: string;
  phone: string;
}

interface SimpleProperty {
  id: string;
  title: string;
}

interface ScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId?: string | null;
  propertyId?: string | null;
  onSuccess?: () => void;
}

export function ScheduleDialog({
  open,
  onOpenChange,
  contactId,
  propertyId,
  onSuccess,
}: ScheduleDialogProps) {
  const supabase = createClient();
  const { user, accountId } = useAuth();

  const [loading, setLoading] = useState(false);
  const [contacts, setContacts] = useState<SimpleContact[]>([]);
  const [properties, setProperties] = useState<SimpleProperty[]>([]);

  // Form fields
  const [title, setTitle] = useState('');
  const [selectedContactId, setSelectedContactId] = useState('');
  const [selectedPropertyId, setSelectedPropertyId] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');

  // Fetch contacts and properties
  const loadOptions = useCallback(async () => {
    if (!accountId) return;
    try {
      const [contactsRes, propertiesRes] = await Promise.all([
        supabase
          .from('contacts')
          .select('id, name, phone')
          .eq('account_id', accountId)
          .eq('status', 'active')
          .order('name'),
        supabase
          .from('properties')
          .select('id, title')
          .eq('account_id', accountId)
          .order('title'),
      ]);

      if (contactsRes.data) setContacts(contactsRes.data);
      if (propertiesRes.data) setProperties(propertiesRes.data);
    } catch (err) {
      console.error('Failed to load options for schedule dialog:', err);
    }
  }, [accountId, supabase]);

  useEffect(() => {
    if (open && accountId) {
      loadOptions();

      // Reset form states
      setTitle('');
      setSelectedContactId(contactId || '');
      setSelectedPropertyId(propertyId || '');
      setLocation('');
      setNotes('');

      // Setup default times (e.g. today starting in 1 hour, duration 1 hour)
      const now = new Date();
      now.setMinutes(0, 0, 0);
      const start = new Date(now.getTime() + 60 * 60 * 1000); // +1 hour
      const end = new Date(start.getTime() + 60 * 60 * 1000);   // +1 hour duration

      const pad = (n: number) => String(n).padStart(2, '0');
      const formatDateTime = (d: Date) =>
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

      setStartTime(formatDateTime(start));
      setEndTime(formatDateTime(end));
    }
  }, [open, accountId, contactId, propertyId, loadOptions]);

  // Keep selectedContactId updated if contactId prop changes
  useEffect(() => {
    if (contactId) {
      setSelectedContactId(contactId);
    }
  }, [contactId]);

  // Keep selectedPropertyId updated if propertyId prop changes
  useEffect(() => {
    if (propertyId) {
      setSelectedPropertyId(propertyId);
    }
  }, [propertyId]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error('Please enter a schedule title / type');
      return;
    }
    if (!startTime || !endTime) {
      toast.error('Start and End times are required');
      return;
    }

    setLoading(true);

    try {
      if (!user || !accountId) {
        throw new Error('Not authenticated or account not loaded');
      }

      const { error } = await supabase.from('appointments').insert({
        account_id: accountId,
        user_id: user.id,
        title: title.trim(),
        description: notes.trim() || null,
        start_time: new Date(startTime).toISOString(),
        end_time: new Date(endTime).toISOString(),
        location: location.trim() || null,
        status: 'scheduled',
        contact_id: selectedContactId || null,
        property_id: selectedPropertyId || null,
      });

      if (error) throw error;

      toast.success('Schedule added successfully');
      onOpenChange(false);
      if (onSuccess) onSuccess();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save schedule';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900 border-slate-700 text-slate-200 sm:max-w-lg overflow-y-auto max-h-[calc(100vh-2rem)] my-auto p-6 shadow-2xl">
        <DialogHeader className="border-b border-slate-800 pb-3">
          <DialogTitle className="text-white flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-primary" />
            Schedule Appointment
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Schedule a call, site visit, or meeting with this client.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSave} className="space-y-4 py-3">
          <div className="space-y-1.5">
            <Label htmlFor="title" className="text-slate-400 text-xs">
              Title / Activity *
            </Label>
            <Input
              id="title"
              required
              placeholder="e.g. Call client, Site Visit - JP Nagar"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="bg-slate-800 border-slate-700 text-white h-9 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="contact" className="text-slate-400 text-xs">
                Link Client / Contact
              </Label>
              <select
                id="contact"
                value={selectedContactId}
                onChange={(e) => setSelectedContactId(e.target.value)}
                disabled={!!contactId}
                className="w-full h-9 rounded-lg border border-slate-700 bg-slate-800 px-3 text-sm text-white focus:border-primary focus:outline-none disabled:opacity-60"
              >
                <option value="">-- Select Contact --</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.phone})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="property" className="text-slate-400 text-xs">
                Link Property Listing
              </Label>
              <select
                id="property"
                value={selectedPropertyId}
                onChange={(e) => setSelectedPropertyId(e.target.value)}
                disabled={!!propertyId}
                className="w-full h-9 rounded-lg border border-slate-700 bg-slate-800 px-3 text-sm text-white focus:border-primary focus:outline-none disabled:opacity-60"
              >
                <option value="">-- Select Property --</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="startTime" className="text-slate-400 text-xs">
                Start Time *
              </Label>
              <Input
                id="startTime"
                type="datetime-local"
                required
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white h-9 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="endTime" className="text-slate-400 text-xs">
                End Time *
              </Label>
              <Input
                id="endTime"
                type="datetime-local"
                required
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white h-9 text-sm"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="location" className="text-slate-400 text-xs">
              Location / Meeting Link
            </Label>
            <Input
              id="location"
              placeholder="e.g. JP Nagar 5th Phase, or Google Meet URL"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="bg-slate-800 border-slate-700 text-white h-9 text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes" className="text-slate-400 text-xs">
              Notes / Description
            </Label>
            <Textarea
              id="notes"
              placeholder="Additional details regarding this task..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="bg-slate-800 border-slate-700 text-white text-sm resize-y"
            />
          </div>

          <DialogFooter className="border-t border-slate-800 pt-4 mt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="border-slate-700 text-slate-300 hover:bg-slate-800 h-9"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading}
              className="bg-primary hover:bg-primary/90 text-primary-foreground h-9"
            >
              {loading && <Loader2 className="size-4 animate-spin mr-1.5" />}
              Save Changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
