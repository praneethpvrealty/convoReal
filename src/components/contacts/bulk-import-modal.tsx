'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Check, Loader2 } from 'lucide-react';

export interface BulkImportContact {
  name: string;
  phone: string;
  email: string;
  classification: 'Owner' | 'Seller' | 'Buyer' | 'Agent' | 'Others';
  selected: boolean;
}

interface BulkImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contacts: BulkImportContact[];
  onImport: (contactsToImport: BulkImportContact[]) => Promise<void>;
}

export function BulkImportModal({
  open,
  onOpenChange,
  contacts: initialContacts,
  onImport,
}: BulkImportModalProps) {
  const [contacts, setContacts] = useState<BulkImportContact[]>(initialContacts);
  const [importing, setImporting] = useState(false);

  // Sync state if initialContacts changes
  if (contacts.length !== initialContacts.length && initialContacts.length > 0) {
    setContacts(initialContacts);
  }

  const toggleSelectAll = (checked: boolean) => {
    setContacts(
      contacts.map((c) => ({
        ...c,
        selected: checked,
      }))
    );
  };

  const toggleSelectContact = (index: number) => {
    setContacts(
      contacts.map((c, i) =>
        i === index ? { ...c, selected: !c.selected } : c
      )
    );
  };

  const updateClassification = (index: number, classification: BulkImportContact['classification']) => {
    setContacts(
      contacts.map((c, i) =>
        i === index ? { ...c, classification } : c
      )
    );
  };

  const updateContactField = (index: number, field: 'name' | 'phone' | 'email', value: string) => {
    setContacts(
      contacts.map((c, i) =>
        i === index ? { ...c, [field]: value } : c
      )
    );
  };

  const allSelected = contacts.length > 0 && contacts.every((c) => c.selected);
  const someSelected = contacts.length > 0 && contacts.some((c) => c.selected) && !allSelected;
  const selectedCount = contacts.filter((c) => c.selected).length;

  const handleImportSubmit = async () => {
    const selected = contacts.filter((c) => c.selected && c.name && c.phone);
    if (selected.length === 0) return;

    setImporting(true);
    try {
      await onImport(selected);
      onOpenChange(false);
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col bg-slate-950 border-slate-800 text-white">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-white">Bulk Device Import</DialogTitle>
          <DialogDescription className="text-slate-400">
            Review, classify, and edit the contacts imported from your phone book before adding them to the database.
          </DialogDescription>
        </DialogHeader>

        {/* Scrollable Table Area */}
        <div className="flex-1 overflow-y-auto my-4 border border-slate-800 rounded-md">
          <Table>
            <TableHeader className="bg-slate-900 border-slate-800 sticky top-0 z-10">
              <TableRow className="border-slate-800">
                <TableHead className="w-12 text-center">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected;
                    }}
                    onChange={(e) => toggleSelectAll(e.target.checked)}
                    className="rounded border-slate-750 bg-slate-800 text-primary focus:ring-primary/40 h-4 w-4 cursor-pointer"
                  />
                </TableHead>
                <TableHead className="text-slate-300 font-semibold">Name</TableHead>
                <TableHead className="text-slate-300 font-semibold">Phone</TableHead>
                <TableHead className="text-slate-300 font-semibold">Email</TableHead>
                <TableHead className="text-slate-300 font-semibold w-40">Classification</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts.map((contact, index) => (
                <TableRow
                  key={index}
                  className={`border-slate-850 hover:bg-slate-900/40 ${
                    !contact.selected && 'opacity-60'
                  }`}
                >
                  <TableCell className="text-center">
                    <input
                      type="checkbox"
                      checked={contact.selected}
                      onChange={() => toggleSelectContact(index)}
                      className="rounded border-slate-750 bg-slate-800 text-primary focus:ring-primary/40 h-4 w-4 cursor-pointer"
                    />
                  </TableCell>
                  <TableCell>
                    <input
                      type="text"
                      value={contact.name}
                      onChange={(e) => updateContactField(index, 'name', e.target.value)}
                      className="bg-transparent border-0 focus:ring-0 focus:border-0 p-0 text-white w-full text-sm font-medium focus:underline"
                      placeholder="Name"
                    />
                  </TableCell>
                  <TableCell>
                    <input
                      type="text"
                      value={contact.phone}
                      onChange={(e) => updateContactField(index, 'phone', e.target.value)}
                      className="bg-transparent border-0 focus:ring-0 focus:border-0 p-0 text-white w-full text-sm focus:underline"
                      placeholder="Phone"
                    />
                  </TableCell>
                  <TableCell>
                    <input
                      type="text"
                      value={contact.email}
                      onChange={(e) => updateContactField(index, 'email', e.target.value)}
                      className="bg-transparent border-0 focus:ring-0 focus:border-0 p-0 text-slate-300 w-full text-sm focus:underline"
                      placeholder="Email (Optional)"
                    />
                  </TableCell>
                  <TableCell>
                    <select
                      value={contact.classification}
                      onChange={(e) =>
                        updateClassification(
                          index,
                          e.target.value as BulkImportContact['classification']
                        )
                      }
                      className="w-full text-xs bg-slate-900 border border-slate-700 text-white rounded px-2 py-1 focus:ring-1 focus:ring-primary focus:border-primary"
                    >
                      <option value="Others">Others</option>
                      <option value="Owner">Owner</option>
                      <option value="Seller">Seller</option>
                      <option value="Buyer">Buyer</option>
                      <option value="Agent">Agent</option>
                    </select>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between border-t border-slate-800 pt-4 gap-2">
          <span className="text-xs text-slate-400">
            Selected <strong>{selectedCount}</strong> of <strong>{contacts.length}</strong> contacts.
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={importing}
              onClick={() => onOpenChange(false)}
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              disabled={selectedCount === 0 || importing}
              onClick={handleImportSubmit}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {importing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Check className="mr-2 h-4 w-4" />
                  Import Selected
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
