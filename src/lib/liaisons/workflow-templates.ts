import type { LiaisonWorkflowStage } from '@/types';

/**
 * Curated, client-shareable process templates for the workflow builder.
 * Bengaluru/Karnataka-flavoured where the process is local (khata, SRO)
 * and pan-India where it isn't (loans, TDS). Durations are indicative —
 * the point is setting client expectations, not quoting SLAs.
 */
export interface WorkflowTemplate {
  key: string;
  service_name: string;
  description: string;
  stages: LiaisonWorkflowStage[];
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    key: 'khata_name_change',
    service_name: 'Change name in the khata document',
    description:
      'Here is how the name change in your khata moves through BBMP, step by step.',
    stages: [
      {
        name: 'Case login',
        authority: 'Case worker',
        duration_days: 3,
        description:
          'Your application and documents (sale deed, EC, tax paid receipt, Aadhaar) are logged in the BBMP system and a case number is issued.',
      },
      {
        name: 'ARO verification & approval',
        authority: 'ARO (Assistant Revenue Officer)',
        duration_days: 7,
        description:
          'The ARO verifies the documents and property records. On approval the case moves up.',
      },
      {
        name: 'JD review & transfer',
        authority: 'JD (Joint Director)',
        duration_days: 7,
        description:
          'The JD reviews the case and transfers it to the DC for final approval.',
      },
      {
        name: 'DC approval',
        authority: 'DC (Deputy Commissioner)',
        duration_days: 10,
        description: 'The DC gives the final approval for the name change.',
      },
      {
        name: 'Khata issued',
        authority: 'BBMP',
        duration_days: 3,
        description:
          'The khata extract and certificate are issued with the new name. We collect and hand them over to you.',
      },
    ],
  },
  {
    key: 'khata_transfer',
    service_name: 'Khata transfer after property purchase',
    description:
      'After your sale deed is registered, the khata must be transferred to your name so BBMP tax records show you as the owner.',
    stages: [
      {
        name: 'Application submission',
        authority: 'Case worker',
        duration_days: 2,
        description:
          'Khata transfer application is filed with your registered sale deed, latest EC, tax paid receipt and Aadhaar; a Sakala acknowledgement is issued.',
      },
      {
        name: 'Document & property verification',
        authority: 'Revenue Inspector',
        duration_days: 7,
        description:
          'The revenue inspector verifies the documents against the property record.',
      },
      {
        name: 'Approval & register update',
        authority: 'ARO (Assistant Revenue Officer)',
        duration_days: 7,
        description:
          'The ARO approves the transfer and the khata register is updated to your name after the khata transfer fee is paid.',
      },
      {
        name: 'Khata certificate & extract issued',
        authority: 'BBMP',
        duration_days: 3,
        description:
          'Updated khata certificate and extract are issued in your name; property tax records now reflect you as the owner.',
      },
    ],
  },
  {
    key: 'builder_reassignment',
    service_name: 'Flat re-assignment through builder (under-construction resale)',
    description:
      'When a flat in an under-construction project is resold before registration, the seller has no sale deed yet — ownership moves by re-assigning the builder allotment to you.',
    stages: [
      {
        name: 'Document verification',
        authority: "Agent / Buyer's advocate",
        duration_days: 3,
        description:
          "Seller's allotment letter, agreement with the builder, payment receipts, demand letters and loan status are verified.",
      },
      {
        name: 'Transfer request to builder',
        authority: 'Seller',
        duration_days: 2,
        description:
          'The seller applies to the builder for transfer of the unit and requests the dues statement and transfer-fee quote.',
      },
      {
        name: 'Builder NOC & dues clearance',
        authority: 'Builder',
        duration_days: 7,
        description:
          'The builder confirms there are no outstanding dues on the unit and issues the No Objection Certificate for the transfer.',
      },
      {
        name: 'Seller loan closure (if any)',
        authority: "Seller's bank",
        duration_days: 10,
        description:
          'If the seller has a loan on the unit, it is foreclosed and the bank releases its NOC and the original documents.',
      },
      {
        name: 'Assignment agreement & payments',
        authority: 'Seller, Buyer & Builder',
        duration_days: 3,
        description:
          "The agreement to assign/transfer is executed, the agreed consideration is paid to the seller, and the builder's transfer fee is paid.",
      },
      {
        name: "Re-allotment in buyer's name",
        authority: 'Builder',
        duration_days: 7,
        description:
          'The builder cancels the old allotment and issues a fresh allotment/endorsed agreement in your name — all future demands and receipts come to you.',
      },
      {
        name: 'Sale deed registration at possession',
        authority: 'Sub-Registrar',
        duration_days: null,
        description:
          'When the project completes, the sale deed is registered directly in your name at the sub-registrar office.',
      },
    ],
  },
  {
    key: 'home_loan',
    service_name: 'Home loan — application to disbursement',
    description:
      'Here is how your home loan moves inside the bank, from application to money out.',
    stages: [
      {
        name: 'Application & document submission',
        authority: 'Applicant',
        duration_days: 2,
        description:
          'Application form is submitted with KYC, income proofs (salary slips / ITR), bank statements and the property papers.',
      },
      {
        name: 'Login & credit check',
        authority: 'Bank',
        duration_days: 2,
        description:
          'The file is logged, the processing fee is collected and your credit bureau (CIBIL) report is pulled.',
      },
      {
        name: 'Credit appraisal',
        authority: 'Bank credit team',
        duration_days: 4,
        description:
          'Income, existing obligations and eligibility are assessed; clarifications may be sought.',
      },
      {
        name: 'Legal & technical verification',
        authority: "Bank's advocate & valuer",
        duration_days: 5,
        description:
          'The property title is vetted by the panel advocate and the flat/site is physically valued.',
      },
      {
        name: 'Sanction',
        authority: 'Sanctioning authority',
        duration_days: 2,
        description:
          'The sanction letter is issued with the approved amount, interest rate and terms.',
      },
      {
        name: 'Agreement & disbursement',
        authority: 'Bank',
        duration_days: 3,
        description:
          'The loan agreement is signed, original property documents are deposited, and the amount is disbursed — usually directly to the seller or builder.',
      },
    ],
  },
  {
    key: 'tds_resident',
    service_name: 'TDS on property purchase (resident seller)',
    description:
      'When you buy from a resident seller for ₹50 lakh or more, you as the buyer must deduct 1% of the sale value as TDS and deposit it — here is the process.',
    stages: [
      {
        name: 'Collect details',
        authority: 'Buyer',
        duration_days: 1,
        description:
          'PAN of buyer and seller, the sale value and the payment schedule are collected. No TAN is needed for this.',
      },
      {
        name: 'Deduct 1% at each payment',
        authority: 'Buyer',
        duration_days: 1,
        description:
          '1% TDS is deducted from every payment made to the seller (including the advance).',
      },
      {
        name: 'File Form 26QB & deposit TDS',
        authority: 'Buyer',
        duration_days: 1,
        description:
          'Form 26QB is filed and the TDS deposited online within 30 days from the end of the month of deduction.',
      },
      {
        name: 'Issue Form 16B to seller',
        authority: 'Buyer',
        duration_days: 7,
        description:
          'The TDS certificate (Form 16B) is downloaded from TRACES and handed to the seller for their records.',
      },
    ],
  },
  {
    key: 'tds_nri',
    service_name: 'TDS when buying from an NRI seller',
    description:
      'Buying from an NRI works very differently from the regular 1% TDS — tax is deducted at the capital-gains rate on the full sale value unless the seller obtains a lower-deduction certificate. Plan for this before the agreement.',
    stages: [
      {
        name: 'Buyer obtains TAN',
        authority: 'Buyer',
        duration_days: 7,
        description:
          'The buyer must register for a TAN (Tax Deduction Account Number) — PAN alone is not sufficient for an NRI purchase.',
      },
      {
        name: 'Lower-deduction certificate (recommended)',
        authority: 'Seller / Income-tax Assessing Officer',
        duration_days: 30,
        description:
          'The seller can apply in Form 13 for a certificate allowing TDS only on the actual capital gains instead of the full sale value — usually worth the wait.',
      },
      {
        name: 'Deduct TDS at applicable rate',
        authority: 'Buyer',
        duration_days: 1,
        description:
          'TDS at the applicable capital-gains rate plus surcharge and cess (or at the certificate rate) is deducted from each payment.',
      },
      {
        name: 'Deposit TDS',
        authority: 'Buyer',
        duration_days: 1,
        description:
          'The deducted tax is deposited via challan by the 7th of the following month.',
      },
      {
        name: 'File Form 27Q',
        authority: 'Buyer',
        duration_days: 7,
        description: 'The quarterly TDS return (Form 27Q) is filed after the quarter ends.',
      },
      {
        name: 'Issue Form 16A to seller',
        authority: 'Buyer',
        duration_days: 7,
        description: 'The TDS certificate is generated from TRACES and given to the seller.',
      },
      {
        name: 'Repatriation of proceeds',
        authority: "Seller's CA & bank",
        duration_days: 7,
        description:
          'To move the sale proceeds abroad, the seller’s CA certifies Form 15CB and Form 15CA is filed with the bank.',
      },
    ],
  },
  {
    key: 'sale_deed_registration',
    service_name: 'Sale deed registration',
    description:
      'The final step of any purchase — registering the sale deed at the sub-registrar office. Here is how it goes.',
    stages: [
      {
        name: 'Deed drafting & review',
        authority: 'Advocate',
        duration_days: 3,
        description:
          'The sale deed is drafted and reviewed by both sides along with the title documents.',
      },
      {
        name: 'Stamp duty payment',
        authority: 'Buyer',
        duration_days: 1,
        description:
          'Stamp duty and registration fee are paid online (K2 challan) against the government guidance value or sale value, whichever is higher.',
      },
      {
        name: 'Slot booking',
        authority: 'Kaveri portal',
        duration_days: 2,
        description:
          'An appointment is booked at the jurisdictional sub-registrar office on Kaveri Online Services.',
      },
      {
        name: 'Execution & registration',
        authority: 'Sub-Registrar',
        duration_days: 1,
        description:
          'Buyer, seller and witnesses sign; photos and biometrics are taken; the deed is registered the same day.',
      },
      {
        name: 'Document release & EC update',
        authority: 'SRO',
        duration_days: 7,
        description:
          'The registered deed is returned and the transaction starts reflecting in the Encumbrance Certificate.',
      },
    ],
  },
  {
    key: 'ec',
    service_name: 'Obtaining Encumbrance Certificate (EC)',
    description:
      'The EC shows every registered transaction on the property for the chosen period — the basic health check before any purchase or loan.',
    stages: [
      {
        name: 'Application',
        authority: 'Applicant / Liaison',
        duration_days: 1,
        description:
          'Applied on Kaveri Online Services with the property schedule and the search period.',
      },
      {
        name: 'SRO search & processing',
        authority: 'SRO',
        duration_days: 4,
        description: 'The sub-registrar office runs the search across its records.',
      },
      {
        name: 'EC issued',
        authority: 'SRO',
        duration_days: 2,
        description: 'The digitally signed EC is issued for download.',
      },
    ],
  },
];
