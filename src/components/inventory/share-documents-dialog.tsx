'use client';

import { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import type { Contact, Property } from '@/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Send, CheckCircle } from 'lucide-react';
import { NameTagBadge } from '@/components/contacts/name-tag-badge';
import { contactHandle } from '@/lib/contacts/reachability';

interface ShareDocumentsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  property?: Property | null;
  contacts: Contact[];
  onShared: () => void;
}

export function ShareDocumentsDialog({
  open,
  onOpenChange,
  property,
  contacts,
  onShared,
}: ShareDocumentsDialogProps) {
  const [shareContactSearchInput, setShareContactSearchInput] = useState('');
  const [isShareContactDropdownOpen, setIsShareContactDropdownOpen] =
    useState(false);
  const [selectedShareContact, setSelectedShareContact] =
    useState<Contact | null>(null);
  const [customShareName, setCustomShareName] = useState('');
  const [customSharePhone, setCustomSharePhone] = useState('');
  const [customShareEmail, setCustomShareEmail] = useState('');
  const [isSharingDoc, setIsSharingDoc] = useState(false);
  const [shareWithPassword, setShareWithPassword] = useState(true);
  const [sharePassword, setSharePassword] = useState('');
  const [shareSuccessData, setShareSuccessData] = useState<{
    shareLink: string;
    password?: string;
    propertyTitle: string;
    requesterName: string;
  } | null>(null);

  // Auto-generate 4-digit passcode when document share dialog opens
  useEffect(() => {
    if (open) {
      const buf = new Uint32Array(1);
      window.crypto.getRandomValues(buf);
      setSharePassword(String(1000 + (buf[0] % 9000)));
      setShareSuccessData(null);
    }
  }, [open]);

  // Close share contact dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-share-contact-dropdown]')) {
        setIsShareContactDropdownOpen(false);
      }
    }
    if (isShareContactDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () =>
        document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isShareContactDropdownOpen]);

  const filteredShareContacts = useMemo(() => {
    if (!shareContactSearchInput.trim()) return contacts;
    const query = shareContactSearchInput.toLowerCase();
    return contacts.filter((c) => {
      const nameMatch = c.name?.toLowerCase().includes(query);
      const phoneMatch = c.phone?.toLowerCase().includes(query);
      const emailMatch = c.email?.toLowerCase().includes(query);
      return nameMatch || phoneMatch || emailMatch;
    });
  }, [contacts, shareContactSearchInput]);

  const handleShareDoc = async () => {
    if (!property?.id) return;

    let reqName = '';
    let reqPhone = '';
    let reqEmail = '';

    if (selectedShareContact) {
      reqName =
        selectedShareContact.name || contactHandle(selectedShareContact);
      reqPhone = selectedShareContact.phone ?? '';
      reqEmail = selectedShareContact.email || '';
    } else {
      reqName = customShareName.trim();
      reqPhone = customSharePhone.trim();
      reqEmail = customShareEmail.trim();
    }

    if (!reqName || !reqPhone) {
      toast.error('Recipient name and phone number are required');
      return;
    }

    setIsSharingDoc(true);
    try {
      const res = await fetch(
        `/api/properties/${property.id}/document-requests`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requester_name: reqName,
            requester_phone: reqPhone,
            requester_email: reqEmail || null,
            access_password:
              shareWithPassword && sharePassword.trim()
                ? sharePassword.trim()
                : null,
          }),
        }
      );

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed');

      toast.success('Documents secure link generated! 🎉');

      if (json.share_link) {
        setShareSuccessData({
          shareLink: json.share_link,
          password: shareWithPassword ? sharePassword.trim() : undefined,
          propertyTitle: property?.title || 'Property',
          requesterName: reqName,
        });

        // Copy nice preformatted message to clipboard
        const niceMsg = `Here is the link for the documents of the property "${property?.title || 'Property'}" asked. Please use the password - ${shareWithPassword ? sharePassword.trim() : 'None'} to open it.\n\n📂 Link: ${json.share_link}`;
        navigator.clipboard.writeText(niceMsg).catch(() => {});
      } else {
        onOpenChange(false);
      }

      onShared();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sharing failed';
      toast.error(msg);
    } finally {
      setIsSharingDoc(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-y-auto border-slate-700 bg-slate-900 p-6 text-slate-200 sm:max-w-md">
        <DialogHeader className="border-b border-slate-800 pb-3">
          <DialogTitle className="flex items-center gap-2 text-white">
            <Send className="text-primary size-5" />
            <span>Share Property Documents</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-400">
            Generate a secure 48-hour access token for this property&apos;s
            documents and send it directly via WhatsApp.
          </DialogDescription>
        </DialogHeader>

        {shareSuccessData ? (
          <div className="space-y-4 py-4 text-center">
            <div className="mb-2 inline-flex h-12 w-12 items-center justify-center rounded-full border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
              <CheckCircle className="size-6 animate-pulse" />
            </div>
            <h3 className="text-sm font-bold text-white">
              Share Link Generated
            </h3>

            <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/40 p-4 text-left">
              <p className="text-[10px] font-bold tracking-wider text-slate-500 uppercase">
                WhatsApp Message Preview
              </p>
              <p className="text-slate-350 max-h-40 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/80 p-3.5 font-mono text-xs leading-relaxed whitespace-pre-wrap select-all">
                {`Here is the link for the documents of the property "${shareSuccessData.propertyTitle}" asked. Please use the password - ${shareSuccessData.password || 'None'} to open it.\n\n📂 Link: ${shareSuccessData.shareLink}`}
              </p>
            </div>

            <div className="flex gap-2 border-t border-slate-800 pt-3">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  const msg = `Here is the link for the documents of the property "${shareSuccessData.propertyTitle}" asked. Please use the password - ${shareSuccessData.password || 'None'} to open it.\n\n📂 Link: ${shareSuccessData.shareLink}`;
                  navigator.clipboard.writeText(msg).then(() => {
                    toast.success('Message copied to clipboard!');
                  });
                }}
                className="hover:bg-slate-750 h-9 flex-1 rounded-lg bg-slate-800 text-xs font-semibold text-slate-300 hover:text-white"
              >
                Copy Message
              </Button>
              <Button
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  setShareSuccessData(null);
                  setSelectedShareContact(null);
                  setShareContactSearchInput('');
                  setCustomShareName('');
                  setCustomSharePhone('');
                  setCustomShareEmail('');
                }}
                className="bg-primary hover:bg-primary/95 text-primary-foreground h-9 flex-1 rounded-lg text-xs font-bold"
              >
                Done
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-4 py-4">
              {/* Recipient Contact Selection */}
              <div className="space-y-1.5" data-share-contact-dropdown>
                <Label className="text-xs font-semibold text-slate-300">
                  Select Existing Contact
                </Label>
                <div className="relative">
                  <Input
                    type="text"
                    placeholder="Search contacts by name or phone..."
                    value={shareContactSearchInput}
                    onChange={(e) => {
                      setShareContactSearchInput(e.target.value);
                      setIsShareContactDropdownOpen(true);
                    }}
                    onFocus={() => setIsShareContactDropdownOpen(true)}
                    readOnly={!!selectedShareContact}
                    className="bg-slate-850 h-9 border-slate-700 text-xs text-white placeholder:text-slate-500"
                  />
                  {selectedShareContact && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedShareContact(null);
                        setShareContactSearchInput('');
                      }}
                      className="absolute top-1/2 right-2 -translate-y-1/2 text-slate-500 hover:text-white"
                    >
                      ×
                    </button>
                  )}

                  {/* Dropdown Menu */}
                  {isShareContactDropdownOpen && !selectedShareContact && (
                    <div className="absolute right-0 left-0 z-50 mt-1 max-h-48 overflow-y-auto rounded-lg border border-slate-700 bg-slate-800 py-1 shadow-xl">
                      {filteredShareContacts.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-slate-500 italic">
                          No contacts found
                        </div>
                      ) : (
                        filteredShareContacts.map((contact) => (
                          <button
                            key={contact.id}
                            type="button"
                            onClick={() => {
                              setSelectedShareContact(contact);
                              setShareContactSearchInput(
                                contact.name || contact.phone || ''
                              );
                              setIsShareContactDropdownOpen(false);
                            }}
                            className="flex w-full items-center justify-between truncate px-3 py-2 text-left text-xs text-slate-200 hover:bg-slate-700"
                          >
                            <span className="flex items-center gap-1.5 font-semibold">
                              {contact.name || 'Unnamed'}
                              <NameTagBadge tag={contact.name_tag} />
                            </span>
                            <span className="font-mono text-[10px] text-slate-400">
                              {contact.phone}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Custom Contact Form (if no contact is selected) */}
              {!selectedShareContact && (
                <div className="border-slate-850 space-y-3 border-t pt-2">
                  <p className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                    Or Enter Custom Recipient
                  </p>
                  <div className="space-y-1">
                    <Label
                      htmlFor="custom-share-name"
                      className="text-[11px] text-slate-400"
                    >
                      Recipient Name
                    </Label>
                    <Input
                      id="custom-share-name"
                      type="text"
                      placeholder="Enter recipient's name"
                      value={customShareName}
                      onChange={(e) => setCustomShareName(e.target.value)}
                      className="bg-slate-850 h-8 border-slate-700 text-xs text-white"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label
                      htmlFor="custom-share-phone"
                      className="text-[11px] text-slate-400"
                    >
                      WhatsApp Phone Number
                    </Label>
                    <Input
                      id="custom-share-phone"
                      type="text"
                      placeholder="e.g. 919876543210"
                      value={customSharePhone}
                      onChange={(e) => setCustomSharePhone(e.target.value)}
                      className="bg-slate-850 h-8 border-slate-700 text-xs text-white"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label
                      htmlFor="custom-share-email"
                      className="text-[11px] text-slate-400"
                    >
                      Email Address (Optional)
                    </Label>
                    <Input
                      id="custom-share-email"
                      type="email"
                      placeholder="e.g. guest@example.com"
                      value={customShareEmail}
                      onChange={(e) => setCustomShareEmail(e.target.value)}
                      className="bg-slate-850 h-8 border-slate-700 text-xs text-white"
                    />
                  </div>
                </div>
              )}

              {selectedShareContact && (
                <div className="border-slate-850 space-y-1 rounded-xl border bg-slate-950/20 p-3.5 text-xs">
                  <p className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                    Selected Recipient Info
                  </p>
                  <p className="flex items-center gap-1.5 font-bold text-white">
                    {selectedShareContact.name || 'Unnamed'}
                    <NameTagBadge tag={selectedShareContact.name_tag} />
                  </p>
                  <p className="font-mono text-[11px] text-slate-400">
                    WhatsApp: {selectedShareContact.phone}
                  </p>
                  {selectedShareContact.email && (
                    <p className="text-[11px] text-slate-400">
                      Email: {selectedShareContact.email}
                    </p>
                  )}
                </div>
              )}

              {/* Password Protection Option */}
              <div className="border-slate-850 space-y-3 border-t pt-3">
                <div className="flex items-center justify-between">
                  <Label
                    htmlFor="share-with-password"
                    className="text-xs font-semibold text-slate-300"
                  >
                    Protect Share with Password
                  </Label>
                  <input
                    id="share-with-password"
                    type="checkbox"
                    checked={shareWithPassword}
                    onChange={(e) => setShareWithPassword(e.target.checked)}
                    className="text-primary focus:ring-primary bg-slate-850 h-4 w-4 rounded border-slate-700"
                  />
                </div>

                {shareWithPassword && (
                  <div className="space-y-1">
                    <Label
                      htmlFor="share-password"
                      className="text-[11px] text-slate-400"
                    >
                      4-Digit Passcode (Auto-generated or custom)
                    </Label>
                    <Input
                      id="share-password"
                      type="text"
                      placeholder="e.g. 4839"
                      value={sharePassword}
                      onChange={(e) => setSharePassword(e.target.value)}
                      maxLength={10}
                      className="bg-slate-850 h-8 border-slate-700 text-center font-mono text-xs tracking-widest text-white"
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-800 pt-3">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  onOpenChange(false);
                  setSelectedShareContact(null);
                  setShareContactSearchInput('');
                }}
                className="h-9 cursor-pointer rounded-lg px-3 text-xs font-semibold text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleShareDoc}
                disabled={isSharingDoc}
                className="bg-primary hover:bg-primary/95 text-primary-foreground h-9 cursor-pointer rounded-lg px-4 text-xs font-bold"
              >
                {isSharingDoc ? 'Sharing...' : 'Generate & Share Link'}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
