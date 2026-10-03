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
  /** Surname split off the phonebook name; with `name` forms the
   *  per-account unique full name. Never sent in messages. */
  second_name: string;
  /** Quick-recall qualifier split off the phonebook name (e.g. "Bank DSA").
   *  Shown only inside the Engine; outbound messages use `name` alone. */
  name_tag: string;
  phone: string;
  email: string;
  classification:
    | 'Owner'
    | 'Seller'
    | 'Buyer'
    | 'Agent'
    | 'Developer'
    | 'Owner & Buyer'
    | 'Others';
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
  const [contacts, setContacts] =
    useState<BulkImportContact[]>(initialContacts);
  const [importing, setImporting] = useState(false);

  // Sync state if initialContacts changes
  if (
    contacts.length !== initialContacts.length &&
    initialContacts.length > 0
  ) {
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

  const updateClassification = (
    index: number,
    classification: BulkImportContact['classification']
  ) => {
    setContacts(
      contacts.map((c, i) => (i === index ? { ...c, classification } : c))
    );
  };

  const updateContactField = (
    index: number,
    field: 'name' | 'second_name' | 'name_tag' | 'phone' | 'email',
    value: string
  ) => {
    setContacts(
      contacts.map((c, i) => (i === index ? { ...c, [field]: value } : c))
    );
  };

  const allSelected = contacts.length > 0 && contacts.every((c) => c.selected);
  const someSelected =
    contacts.length > 0 && contacts.some((c) => c.selected) && !allSelected;
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
      <DialogContent className="flex max-h-[85vh] max-w-4xl flex-col overflow-hidden border-slate-800 bg-slate-950 text-white">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-white">
            Bulk Device Import
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Review, classify, and edit the contacts imported from your phone
            book before adding them to the database.
          </DialogDescription>
        </DialogHeader>

        {/* Scrollable Table Area */}
        <div className="my-4 flex-1 overflow-y-auto rounded-md border border-slate-800">
          <Table>
            <TableHeader className="sticky top-0 z-10 border-slate-800 bg-slate-900">
              <TableRow className="border-slate-800">
                <TableHead className="w-12 text-center">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected;
                    }}
                    onChange={(e) => toggleSelectAll(e.target.checked)}
                    className="border-slate-750 text-primary focus:ring-primary/40 h-4 w-4 cursor-pointer rounded bg-slate-800"
                  />
                </TableHead>
                <TableHead className="font-semibold text-slate-300">
                  Name
                </TableHead>
                <TableHead className="font-semibold text-slate-300">
                  Second Name
                </TableHead>
                <TableHead className="font-semibold text-slate-300">
                  Name Tag
                  <span className="block text-[10px] font-normal text-slate-500 normal-case">
                    Engine-only label — not sent in messages
                  </span>
                </TableHead>
                <TableHead className="font-semibold text-slate-300">
                  Phone
                </TableHead>
                <TableHead className="font-semibold text-slate-300">
                  Email
                </TableHead>
                <TableHead className="w-40 font-semibold text-slate-300">
                  Classification
                </TableHead>
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
                      className="border-slate-750 text-primary focus:ring-primary/40 h-4 w-4 cursor-pointer rounded bg-slate-800"
                    />
                  </TableCell>
                  <TableCell>
                    <input
                      type="text"
                      value={contact.name}
                      onChange={(e) =>
                        updateContactField(index, 'name', e.target.value)
                      }
                      className="w-full border-0 bg-transparent p-0 text-sm font-medium text-white focus:border-0 focus:underline focus:ring-0"
                      placeholder="Name"
                    />
                  </TableCell>
                  <TableCell>
                    <input
                      type="text"
                      value={contact.second_name}
                      onChange={(e) =>
                        updateContactField(index, 'second_name', e.target.value)
                      }
                      className="w-full border-0 bg-transparent p-0 text-sm text-slate-300 focus:border-0 focus:underline focus:ring-0"
                      placeholder="—"
                      title="Auto-suggested from the phonebook name — edit or clear as needed"
                    />
                  </TableCell>
                  <TableCell>
                    <input
                      type="text"
                      value={contact.name_tag}
                      onChange={(e) =>
                        updateContactField(index, 'name_tag', e.target.value)
                      }
                      className={`w-full rounded border-0 px-1.5 py-0.5 text-sm focus:border-0 focus:underline focus:ring-0 ${
                        contact.name_tag
                          ? 'bg-slate-800/80 text-slate-300'
                          : 'bg-transparent text-slate-500'
                      }`}
                      placeholder="—"
                      title="Auto-suggested from the phonebook name — edit or clear as needed"
                    />
                  </TableCell>
                  <TableCell>
                    <input
                      type="text"
                      value={contact.phone}
                      onChange={(e) =>
                        updateContactField(index, 'phone', e.target.value)
                      }
                      className="w-full border-0 bg-transparent p-0 text-sm text-white focus:border-0 focus:underline focus:ring-0"
                      placeholder="Phone"
                    />
                  </TableCell>
                  <TableCell>
                    <input
                      type="text"
                      value={contact.email}
                      onChange={(e) =>
                        updateContactField(index, 'email', e.target.value)
                      }
                      className="w-full border-0 bg-transparent p-0 text-sm text-slate-300 focus:border-0 focus:underline focus:ring-0"
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
                      className="focus:ring-primary focus:border-primary w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white focus:ring-1"
                    >
                      <option value="Others">Others</option>
                      <option value="Owner">Owner</option>
                      <option value="Seller">Seller</option>
                      <option value="Buyer">Buyer</option>
                      <option value="Agent">Agent</option>
                      <option value="Developer">Developer</option>
                      <option value="Owner & Buyer">Owner & Buyer</option>
                    </select>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <DialogFooter className="flex items-center justify-between gap-2 border-t border-slate-800 pt-4 sm:justify-between">
          <span className="text-xs text-slate-400">
            Selected <strong>{selectedCount}</strong> of{' '}
            <strong>{contacts.length}</strong> contacts.
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
