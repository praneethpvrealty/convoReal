# Signing a brokerage invoice under Indian law

> This is an engineering note on what the product implements and what it
> would take to go further. It is not legal advice — a chartered
> accountant or counsel should confirm what your firm actually needs,
> particularly the GST registration question in §5.

## 1. What the law asks for

Two rules meet on a brokerage invoice.

**The IT Act, 2000** recognises two things:

- **s.3 — a digital signature**: asymmetric cryptography over a hash,
  made with a key whose certificate comes from a Certifying Authority
  licensed by the Controller of Certifying Authorities (CCA). This is
  the strong form, and the one the Evidence Act's s.85B presumptions
  attach to.
- **s.3A — an electronic signature**: any technique listed in the
  Second Schedule, which today means Aadhaar-based e-authentication
  (eSign) alongside digital signatures. **s.5** gives a signature
  requirement in any other law the option of being met electronically.

**CGST Rule 46** requires a tax invoice to carry the signature or
digital signature of the supplier or their authorised representative,
with a proviso: the signature is not required where the invoice is
issued **in accordance with the IT Act's provisions**. That proviso is
what an electronic signature is for. It is also why an *unsigned* PDF
with no audit trail is the weakest option, not the neutral one — the
renderer therefore stamps "This is a computer-generated invoice" on
anything issued with `signature_mode = 'none'`.

## 2. Three tiers, and what each costs to build

| Tier | Legal standing | Runs on a server? | What it needs |
| --- | --- | --- | --- |
| `image` | Electronic signature (s.3A/s.5). Admissible; no s.85B presumption on its own — the audit trail is what gives it weight | Yes | Nothing. **Implemented.** |
| `dsc` | Digital signature (s.3). Presumption under Evidence Act s.85B | Only with an **HSM-held** certificate | A Class 3 **document signer** certificate from a CCA-licensed CA (eMudhra, Sify, (n)Code, Capricorn, Verasys…), held in an HSM or a cloud signing service |
| `esign` | Electronic signature (s.3A, Second Schedule) | Yes | A commercial agreement with a CCA-empanelled **eSign Service Provider** (eMudhra, Protean/NSDL, C-DAC…), plus per-signature cost |

The thing worth knowing before choosing: **a Class 3 DSC on a USB token
cannot be used by a server.** The private key never leaves the token by
design, so signing requires a human with the token plugged into a
machine running a PKCS#11 client. Server-side DSC signing means an
*organisational* certificate held in an HSM — a different product from
the CA, usually sold with a per-year or per-signature contract.

Both `dsc` and `esign` therefore need a commercial decision the product
cannot make on an account's behalf. That is why the columns, the modes
and the PDF seam exist and the provider call does not.

## 3. What is implemented

Setting `signature_mode = 'image'` (the default) gives, at issue:

1. **The signature block on the page** — the scanned signature image
   (private `signatures` bucket, never public), the signatory's name and
   designation, the place, and "Electronically signed on <date>".
2. **`invoices.document_hash`** — SHA-256 of the exact rendered bytes.
   The PDF is deterministic (`/CreationDate` derives from the invoice
   date, the `/ID` from the document), so re-rendering the frozen
   snapshot must reproduce the same hash. `GET /api/invoices/[id]/pdf`
   compares them on every download and logs a mismatch.
3. **`invoice_events`** — an append-only trail: who issued it, from
   which IP, with which user agent, at what time, over which hash, plus
   every later send, download, payment and cancellation. RLS grants
   `SELECT` and `INSERT` and no `UPDATE` or `DELETE`, so the trail
   cannot be tidied up afterwards through the normal client.
4. **Immutability** — an issued invoice cannot be edited or deleted.
   The only way to change one is to cancel it, which keeps its number so
   the series has no gap, and raise a new one.

That combination is what makes the signature evidentially useful: the
image on its own proves little, and "who pressed Issue, when, from
where, over exactly these bytes" is the part that stands up.

## 4. The seam for a real digital signature

`src/lib/invoices/pdf-writer.ts` can reserve a **PAdES** signature field
when the mode is `dsc` or `esign`, and `renderInvoicePdf` passes
`reserveSignatureField` for exactly those. It emits:

- an `/AcroForm` with `/SigFlags 3` and one `/Sig` widget over the
  signature area of the page;
- a signature dictionary with `/Filter /Adobe.PPKLite` and
  `/SubFilter /ETSI.CAdES.detached`;
- `/Contents <0000…>` — 8 KB of hex zeros, room for a CMS blob and its
  certificate chain;
- `/ByteRange [0 a b c]`, computed after assembly and written back over
  a fixed-width placeholder so the substitution changes no byte offsets.

The two ranges cover the whole file **except** the hex string, which is
what a PAdES signature is defined over. `pdf.test.ts` asserts that
`hexEnd + tailLength === pdf.length` and that the range brackets land on
the `<` and `>`, because an off-by-one there produces a PDF that opens
fine and reports an invalid signature.

To finish the integration, a provider module needs to:

1. render with `reserveSignatureField: true`;
2. hash the two `ByteRange` segments (this is what
   `invoices.document_hash` already is for the unsigned document — the
   signed variant hashes the same way, minus the placeholder);
3. get a PKCS#7/CMS detached signature over that hash — from the HSM
   for `dsc`, or from the ESP's API after the signer's Aadhaar OTP for
   `esign`;
4. write the DER-encoded blob as hex into `/Contents`, padded with
   zeros to the reserved length — **without changing the file's size**;
5. store the provider reference and certificate details on
   `invoices.signature` (`provider`, `provider_ref`,
   `certificate_subject`, `certificate_serial`) and set `signed_at`;
6. write a `signed` row into `invoice_events`.

Step 4 is the one that catches people out: the signature covers the file
around itself, so the file cannot grow or shrink after the hash is taken.

## 5. Two things to confirm with your CA

**Whether a tax invoice is the right document at all.** The reference
invoice this feature was modelled on shows `IGST @ NIL / SGST @ NIL /
CGST @ NIL` with GSTIN marked `NA` and a note that turnover is below
₹20 lakh. A supplier who is not registered for GST does not issue a
*tax invoice* and does not show tax rows — they issue an ordinary
commercial invoice. The `nil` mode prints the rows because that is what
the existing document does, and changing it silently would have been a
change to a legal document nobody asked for. Worth a five-minute
conversation.

**e-invoicing does not apply here — check that it still doesn't.**
Reporting to the Invoice Registration Portal (IRN + signed QR) is
mandatory only above an aggregate annual turnover threshold (₹5 crore
at the time of writing, lowered several times since 2020). Below it
there is no IRN and no portal signature, which is why this feature
generates the PDF itself. A brokerage growing past the threshold would
need IRP integration, and the invoice would then be digitally signed by
the IRP rather than by the firm.

## 6. Pointers

| What | Where |
| --- | --- |
| Signature modes and the settings columns | `supabase/migrations/20260914120000_invoice_settings.sql` |
| Frozen signature block, `document_hash`, audit trail | `supabase/migrations/20260914120100_invoices.sql` |
| PAdES placeholder and `/ByteRange` patching | `src/lib/invoices/pdf-writer.ts` |
| Where the signature is drawn on the page | `src/lib/invoices/pdf.ts` |
| Hashing and re-render comparison | `src/lib/invoices/server.ts`, `src/app/api/invoices/[id]/pdf/route.ts` |
| Audit events | `logInvoiceEvent` in `src/lib/invoices/server.ts` |
| Tests covering the seam | `src/lib/invoices/pdf.test.ts` (`describe('signature field')`) |
