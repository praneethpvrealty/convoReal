import { supabaseAdmin } from '@/lib/automations/admin-client';
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { placeReminderCall } from '@/lib/voice/reminder-call';
import {
  enqueueReminderAudioJob,
  reminderSpokenText,
} from '@/lib/voice/reminder-audio';
import { getVoiceConfig } from '@/lib/voice/config';
import { isWithinCustomerWindow } from '@/lib/whatsapp/customer-window';
import {
  loadTemplateForContact,
  warnLanguageFallback,
} from '@/lib/whatsapp/template-language';
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api';
import { decrypt } from '@/lib/whatsapp/encryption';
import { istDayWindow, istHourOf } from '@/lib/calendar/whatsapp-scheduler';
import { localityLabel } from '@/lib/inventory/location-guard';
import type { SupabaseClient } from '@supabase/supabase-js';

// ============================================================
// Client-facing appointment reminders. Every appointment can now
// carry several contacts (buyer, partner agent, owner…) via
// contact_ids, and each reminder goes to ALL of them — except
// event_type = 'call', where the contact is the one being called
// and a "reminder to expect our call" reads as noise. Those events
// stay agent-only: the assignee still gets the pre-event brief and
// morning digest from lib/calendar/agent-reminders.ts.
//
//   1. Morning-of brief once ~7 AM IST opens (reminder_morning_sent)
//   2. One hour before the meeting          (reminder_1h_sent)
//
// Delivery is tracked per recipient in appointment_reminder_log:
// a unique (appointment, contact, type) claim row is inserted
// before each send and released again if the send fails, so a
// partial failure retries ONLY the missed recipients on the next
// cron tick — no duplicates for the ones already reached. The
// appointment-level flag flips only once every reachable recipient
// is covered.
// ============================================================

const HOUR_MS = 60 * 60 * 1000;

/**
 * What the reminder says when nobody typed a meeting point.
 *
 * Meta rejects an empty template parameter, so {{4}} always needs
 * something — but the old filler was the words "Scheduled Location",
 * which went out to clients as "Location: Scheduled Location". That
 * reads like a variable nobody filled in, because it is one. This at
 * least states a fact and sets an expectation.
 */
export const LOCATION_TO_FOLLOW = 'to be shared before the visit';

/** Property fields the location text needs. */
export interface ReminderProperty {
  title?: string | null;
  type?: string | null;
  location_privacy?: string | null;
  location?: string | null;
  sublocality?: string | null;
  city?: string | null;
  state?: string | null;
}

/**
 * Where the client is being told to go.
 *
 * The appointment's own `location` wins: an agent who typed a meeting
 * point meant that exact string, and it is the only field that can say
 * "site office gate, opposite the water tank".
 *
 * Failing that, the linked property answers with its full address —
 * and this is a DELIBERATE exception to the location guard, which
 * src/lib/inventory/location-guard.ts otherwise applies to every
 * surface that serializes a property for an external viewer.
 *
 * The guard exists to stop a rival agent identifying a house or plot
 * from a public listing and approaching the owner directly. A booked
 * site visit is not that: the brokerage chose this person, chose the
 * date, and is taking them to the gate. Withholding the address there
 * protects nothing and only makes the client ask for it — which is the
 * agent's phone ringing at 7am to read out a street name.
 *
 * The exception is scoped to exactly that: an appointment already in
 * the diary, reminding people who are on it. Nothing here widens what
 * the showcase, a share link or the Q&A bot will reveal.
 */
export function reminderLocationText(
  appointmentLocation: string | null | undefined,
  property: ReminderProperty | null | undefined
): string {
  const typed = (appointmentLocation || '').trim();
  if (typed) return typed;

  const exact = (property?.location || '').trim();
  if (exact) return exact;

  // No street address on the listing either — the locality still beats
  // saying nothing, unless it degrades to localityLabel's own showcase
  // fallback, which answers a question the client did not ask.
  if (property) {
    const label = localityLabel(property);
    if (label && !/available on request/i.test(label)) return label;
  }

  return LOCATION_TO_FOLLOW;
}

// property_visit_reminder wording only fits event_type = 'site_visit'.
// Everything else (meeting, call, follow_up, document, other) uses the
// generic pair seeded DRAFT by migration 140 — sending "your scheduled
// property visit" for a plain meeting or call reminder is confusing.
const BASE_TEMPLATE_NAME = 'property_visit_reminder';
// Agenda-carrying template variant (seeded DRAFT by migration 129).
// Used only for accounts whose copy Meta has APPROVED; everyone else
// stays on the original 5-placeholder template.
const AGENDA_TEMPLATE_NAME = 'property_visit_reminder_agenda';
const GENERIC_TEMPLATE_NAME = 'appointment_reminder';
const GENERIC_AGENDA_TEMPLATE_NAME = 'appointment_reminder_agenda';

type ReminderType = 'morning' | '1h';

interface ReminderContact {
  id: string;
  name: string | null;
  phone: string | null;
  preferred_update_channel?: string | null;
}

interface ReminderAppointment {
  id: string;
  account_id: string;
  user_id: string | null;
  title: string;
  start_time: string;
  location: string | null;
  agenda: string | null;
  event_type: string;
  contact_id: string | null;
  contact_ids: string[] | null;
  reminder_morning_sent: boolean;
  reminder_1h_sent: boolean;
  remind_liaison: boolean;
  liaison_id: string | null;
  liaison: { id: string; name: string | null; phone: string | null } | null;
  property: (ReminderProperty & { id: string }) | null;
  account: { name: string } | null;
}

/** Union of the multi-contact array and the legacy single column. */
function recipientIds(appt: ReminderAppointment): string[] {
  const ids = new Set<string>(appt.contact_ids || []);
  if (appt.contact_id) ids.add(appt.contact_id);
  return [...ids];
}

/** Returns null on fetch failure so the caller can abort the tick —
 *  an empty map here must never be mistaken for "no recipients". */
async function loadContacts(
  admin: SupabaseClient,
  ids: string[]
): Promise<Map<string, ReminderContact> | null> {
  const map = new Map<string, ReminderContact>();
  if (ids.length === 0) return map;
  const { data, error } = await admin
    .from('contacts')
    .select('id, name, phone, preferred_update_channel')
    .in('id', ids);
  if (error) {
    console.error('[Reminder Cron] contacts fetch failed:', error);
    return null;
  }
  for (const c of data || []) map.set(c.id, c as ReminderContact);
  return map;
}

/** Meta rejects template params containing newlines/tabs, and long
 *  params can push the rendered body past its limit — flatten the
 *  free-text agenda into one bounded line. */
function sanitizeTemplateParam(text: string, max = 300): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function formatIstTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Sends one reminder to every contact attached to the appointment,
 * claiming each recipient in appointment_reminder_log first.
 * Returns true when every reachable recipient is covered (sent now
 * or on an earlier tick) — only then should the appointment-level
 * flag be marked, so missed recipients retry next tick.
 */
async function sendToAllRecipients(
  admin: SupabaseClient,
  appt: ReminderAppointment,
  contacts: Map<string, ReminderContact>,
  reminderType: ReminderType,
  isSiteVisit: boolean,
  useAgendaTemplate: boolean
): Promise<boolean> {
  const reachable = recipientIds(appt)
    .map((id) => contacts.get(id))
    .filter(
      (c): c is ReminderContact =>
        !!c && !!c.phone && isValidE164(sanitizePhoneForMeta(c.phone))
    );

  if (reachable.length === 0) {
    console.warn(
      `[Reminder Cron] No reachable contacts for appointment ${appt.id} (${reminderType})`
    );
    return true; // nothing to retry — mark sent so we stop re-scanning it
  }

  const accountName = appt.account?.name || 'our team';
  const formattedTime = formatIstTime(appt.start_time);
  const agendaParam =
    useAgendaTemplate && appt.agenda
      ? sanitizeTemplateParam(appt.agenda)
      : null;
  const templateName = isSiteVisit
    ? agendaParam
      ? AGENDA_TEMPLATE_NAME
      : BASE_TEMPLATE_NAME
    : agendaParam
      ? GENERIC_AGENDA_TEMPLATE_NAME
      : GENERIC_TEMPLATE_NAME;

  // Contacts who asked for audio updates get the reminder spoken and
  // sent as a voice note — a queue-worker TTS job, because Sarvam and
  // ffmpeg only run there. Gated on the account's opt-in (the render
  // costs credits) and on each contact's 24-hour window (a voice note
  // is a free-form message). Anyone the gate excludes stays on the
  // template below.
  const wantsAudio = reachable.filter(
    (c) => c.preferred_update_channel === 'whatsapp_audio'
  );
  let audioEnabled = false;
  const audioWindows = new Map<string, string | null>();
  if (wantsAudio.length > 0 && process.env.REDIS_URL) {
    const voiceConfig = await getVoiceConfig(admin, appt.account_id);
    if (voiceConfig?.reminder_audio_enabled) {
      audioEnabled = true;
      const { data: convos } = await admin
        .from('conversations')
        .select('contact_id, last_customer_message_at')
        .eq('account_id', appt.account_id)
        .in(
          'contact_id',
          wantsAudio.map((c) => c.id)
        );
      for (const c of convos ?? []) {
        audioWindows.set(c.contact_id, c.last_customer_message_at);
      }
    }
  }

  let allCovered = true;
  for (const contact of reachable) {
    // Claim this recipient. A unique-violation means an earlier tick
    // already delivered (or another cron instance owns it) — skip.
    const { error: claimErr } = await admin
      .from('appointment_reminder_log')
      .insert({
        account_id: appt.account_id,
        appointment_id: appt.id,
        contact_id: contact.id,
        reminder_type: reminderType,
      });
    if (claimErr) {
      if (claimErr.code !== '23505') {
        console.error('[Reminder Cron] claim insert failed:', claimErr);
        allCovered = false;
      }
      continue;
    }

    const clientName = contact.name || 'Client';
    const visitTitle =
      appt.property?.title ||
      appt.title ||
      (isSiteVisit ? 'Property visit' : 'Appointment');
    const locationText = reminderLocationText(appt.location, appt.property);

    // A contact who asked for phone-call updates gets the reminder as a
    // voice-agent call when the account opted in (Settings → WhatsApp →
    // Voice); any failure falls through to the WhatsApp template below
    // so the reminder still lands. The claim above stays either way.
    if (contact.preferred_update_channel === 'voice_call') {
      const called = await placeReminderCall({
        admin,
        accountId: appt.account_id,
        contactId: contact.id,
        phone: contact.phone!,
        retryKey: `voice-reminder:${appt.id}:${contact.id}:${reminderType}`,
        context: {
          contact_name: clientName,
          appointment_title: visitTitle,
          appointment_time: formattedTime,
          location: locationText,
          brand_name: accountName,
        },
      });
      if (called) {
        console.log(
          `[Reminder Cron] Placed ${reminderType} reminder CALL for appt ${appt.id} to contact ${contact.id}`
        );
        continue;
      }
    }
    // Must mirror the four approved template bodies word-for-word —
    // Meta renders {{n}} positionally against whatever it approved,
    // so this string is only the local Inbox preview copy, but it
    // should still read the same as what the client actually got.
    // (Wording constraints: >=3 static words per {{n}} for Meta's
    // Utility-template density check, and no variable at the start or
    // end of the body even wrapped in punctuation — see
    // supabase/migrations/143_reminder_template_wording_fix.sql and
    // 145_reminder_template_trailing_variable_fix.sql.)
    let bodyText: string;
    if (isSiteVisit && !agendaParam) {
      bodyText = `Hi ${clientName}, this is a friendly reminder from ${accountName} about your scheduled property visit for "${visitTitle}" on ${formattedTime}. Location: ${locationText}. Please tap a button below to confirm or request a change.`;
    } else if (isSiteVisit) {
      bodyText = `Hi ${clientName}, this is a friendly reminder from ${accountName} that you have a scheduled property visit for "${visitTitle}" on ${formattedTime}. Location: ${locationText}. Agenda for the visit: ${agendaParam}. Please tap a button below to confirm or request a change.`;
    } else if (!agendaParam) {
      bodyText = `Hi ${clientName}, this is a friendly reminder from ${accountName} that you have a scheduled meeting: "${visitTitle}" on ${formattedTime}. Location: ${locationText}. Please tap a button below to confirm or request a change.`;
    } else {
      bodyText = `Hi ${clientName}, this is a friendly reminder from ${accountName} that you have a scheduled meeting: "${visitTitle}" on ${formattedTime}. Location: ${locationText}. Agenda for the meeting: ${agendaParam}. Please tap a button below to confirm or request a change.`;
    }

    const templateParams = agendaParam
      ? [
          clientName,
          visitTitle,
          formattedTime,
          locationText,
          agendaParam,
          accountName,
        ]
      : [clientName, visitTitle, formattedTime, locationText, accountName];

    if (
      audioEnabled &&
      contact.preferred_update_channel === 'whatsapp_audio' &&
      isWithinCustomerWindow(audioWindows.get(contact.id))
    ) {
      const queued = await enqueueReminderAudioJob({
        kind: 'reminder_audio',
        accountId: appt.account_id,
        appointmentId: appt.id,
        contactId: contact.id,
        userId: appt.user_id || null,
        reminderType,
        spokenText: reminderSpokenText({
          clientName,
          brandName: accountName,
          title: visitTitle,
          formattedTime,
          locationText,
          agenda: agendaParam,
          isSiteVisit,
        }),
        fallback: { templateName, templateParams, bodyText },
      });
      if (queued) {
        console.log(
          `[Reminder Cron] Queued ${reminderType} reminder NOTE for appt ${appt.id} to contact ${contact.id}`
        );
        continue;
      }
    }

    // The reminder goes to THIS contact, so their language decides the
    // variant. Resolved per recipient rather than per appointment: one
    // site visit can have a Tamil buyer and an English co-broker on it.
    const {
      template: langTemplate,
      language,
      fellBack,
    } = await loadTemplateForContact(admin, {
      accountId: appt.account_id,
      contactId: contact.id,
      names: [templateName],
    });
    if (fellBack) {
      warnLanguageFallback(
        'Reminder Cron',
        appt.account_id,
        language,
        langTemplate
      );
    }

    const result = await sendWhatsAppMessageAndPersist({
      accountId: appt.account_id,
      userId: appt.user_id || null,
      contactId: contact.id,
      kind: 'template',
      senderType: 'agent', // reminders logged as sent by agent
      templateName,
      templateLanguage: langTemplate?.language || 'en_US',
      templateParams,
      text: bodyText, // Store formatted preview text in DB
      customDbClient: admin,
    });

    if (result.success) {
      console.log(
        `[Reminder Cron] Sent ${reminderType} reminder for appt ${appt.id} to contact ${contact.id}`
      );
      // Record Meta's message id on the claim row so the webhook can
      // match an inbound "Fine" / "Requesting reschedule" button tap
      // (its context.id) back to this appointment.
      if (result.whatsappMessageId) {
        await admin
          .from('appointment_reminder_log')
          .update({ wa_message_id: result.whatsappMessageId })
          .eq('appointment_id', appt.id)
          .eq('contact_id', contact.id)
          .eq('reminder_type', reminderType);
      }
    } else {
      console.error(
        `[Reminder Cron] Failed ${reminderType} reminder to ${contact.phone}:`,
        result.error
      );
      allCovered = false;
      // Release the claim so the next tick retries this recipient.
      await admin
        .from('appointment_reminder_log')
        .delete()
        .eq('appointment_id', appt.id)
        .eq('contact_id', contact.id)
        .eq('reminder_type', reminderType);
    }
  }
  return allCovered;
}

// ── Liaison reminders (opt-in per event) ─────────────────────────
// A liaison (lawyer, surveyor, khata agent) is deliberately not a
// contact, so their reminder bypasses the dispatcher — a raw template
// send to liaisons.phone with no contact or conversation row created.
// Claims use the same appointment_reminder_log keyed on liaison_id.

interface LiaisonWaConfig {
  phoneNumberId: string;
  accessToken: string;
}

/** Per-tick cache: account_id → send credentials, or null when the
 *  account is unconfigured/sandbox (sandbox numbers can only message
 *  registered testers, so liaison sends are skipped there). */
async function loadLiaisonWaConfig(
  admin: SupabaseClient,
  accountId: string,
  cache: Map<string, LiaisonWaConfig | null>
): Promise<LiaisonWaConfig | null> {
  if (cache.has(accountId)) return cache.get(accountId) ?? null;
  let out: LiaisonWaConfig | null = null;
  const { data: config } = await admin
    .from('whatsapp_config')
    .select('phone_number_id, access_token, integration_type')
    .eq('account_id', accountId)
    .maybeSingle();
  if (
    config &&
    config.integration_type !== 'sandbox' &&
    config.phone_number_id &&
    config.access_token
  ) {
    try {
      out = {
        phoneNumberId: config.phone_number_id,
        accessToken: decrypt(config.access_token),
      };
    } catch (err) {
      console.error('[Reminder Cron] liaison config decrypt failed:', err);
    }
  }
  cache.set(accountId, out);
  return out;
}

/**
 * Same claim/release contract as sendToAllRecipients: returns true
 * when the liaison is covered (sent now, sent earlier, or genuinely
 * unreachable), false when the send failed and should retry next tick.
 */
async function sendLiaisonReminder(
  admin: SupabaseClient,
  appt: ReminderAppointment,
  reminderType: ReminderType,
  isSiteVisit: boolean,
  waCache: Map<string, LiaisonWaConfig | null>
): Promise<boolean> {
  if (!appt.remind_liaison || !appt.liaison_id || !appt.liaison) return true;

  const phone = appt.liaison.phone
    ? sanitizePhoneForMeta(appt.liaison.phone)
    : '';
  if (!phone || !isValidE164(phone)) {
    console.warn(
      `[Reminder Cron] Liaison ${appt.liaison_id} has no valid phone for appt ${appt.id}`
    );
    return true; // nothing to retry
  }

  const wa = await loadLiaisonWaConfig(admin, appt.account_id, waCache);
  if (!wa) {
    console.warn(
      `[Reminder Cron] No liaison-capable WhatsApp config for account ${appt.account_id}`
    );
    return true;
  }

  const { error: claimErr } = await admin
    .from('appointment_reminder_log')
    .insert({
      account_id: appt.account_id,
      appointment_id: appt.id,
      liaison_id: appt.liaison_id,
      reminder_type: reminderType,
    });
  if (claimErr) {
    if (claimErr.code !== '23505') {
      console.error('[Reminder Cron] liaison claim insert failed:', claimErr);
      return false;
    }
    return true; // already delivered on an earlier tick
  }

  const templateName = isSiteVisit ? BASE_TEMPLATE_NAME : GENERIC_TEMPLATE_NAME;
  const visitTitle =
    appt.property?.title ||
    appt.title ||
    (isSiteVisit ? 'Property visit' : 'Appointment');
  try {
    await sendTemplateMessage({
      phoneNumberId: wa.phoneNumberId,
      accessToken: wa.accessToken,
      to: phone,
      templateName,
      language: 'en_US',
      params: [
        appt.liaison.name || 'Partner',
        visitTitle,
        formatIstTime(appt.start_time),
        reminderLocationText(appt.location, appt.property),
        appt.account?.name || 'our team',
      ],
    });
    console.log(
      `[Reminder Cron] Sent ${reminderType} reminder for appt ${appt.id} to liaison ${appt.liaison_id}`
    );
    return true;
  } catch (err) {
    console.error(
      `[Reminder Cron] Failed ${reminderType} liaison reminder for appt ${appt.id}:`,
      err
    );
    await admin
      .from('appointment_reminder_log')
      .delete()
      .eq('appointment_id', appt.id)
      .eq('liaison_id', appt.liaison_id)
      .eq('reminder_type', reminderType);
    return false;
  }
}

export async function checkAndSendAppointmentReminders(
  now: Date = new Date()
): Promise<void> {
  const admin = supabaseAdmin();
  const oneHourOut = new Date(now.getTime() + HOUR_MS);
  const { endIso: dayEndIso } = istDayWindow(now);
  const dayEndMs = new Date(dayEndIso).getTime();
  const morningWindowOpen = istHourOf(now) >= 7;

  // One fetch covers both passes: everything left today (IST) plus
  // anything inside the 1h window that spills past IST midnight.
  const horizonIso = new Date(
    Math.max(dayEndMs, oneHourOut.getTime())
  ).toISOString();

  const { data: appointments, error } = await admin
    .from('appointments')
    .select(
      'id, account_id, user_id, title, start_time, location, agenda, event_type, contact_id, contact_ids, reminder_morning_sent, reminder_1h_sent, remind_liaison, liaison_id, liaison:liaisons(id, name, phone), property:properties(id, title, type, location_privacy, location, sublocality, city, state), account:accounts(name)'
    )
    .eq('status', 'scheduled')
    .neq('event_type', 'call')
    .gt('start_time', now.toISOString())
    .lte('start_time', horizonIso)
    .or('reminder_morning_sent.eq.false,reminder_1h_sent.eq.false');

  if (error) {
    console.error('[Reminder Cron] Error fetching appointments:', error);
    return;
  }
  if (!appointments || appointments.length === 0) return;

  const rows = appointments as unknown as ReminderAppointment[];
  const contacts = await loadContacts(admin, [
    ...new Set(rows.flatMap(recipientIds)),
  ]);
  if (!contacts) return; // transient failure — retry the whole tick later
  const liaisonWaCache = new Map<string, LiaisonWaConfig | null>();

  // Accounts whose agenda-carrying template variant Meta has approved
  // get the agenda in client reminders; everyone else stays on the
  // original template. A lookup failure just means "fall back" — it
  // must never block the reminders themselves. Site-visit and generic
  // (meeting/call/follow_up/document/other) appointments each have
  // their own template pair, approved independently per account.
  const siteVisitAgendaAccounts = new Set<string>();
  const genericAgendaAccounts = new Set<string>();
  const apptsWithAgenda = rows.filter((r) => r.agenda);
  if (apptsWithAgenda.length > 0) {
    const { data: agendaTemplates, error: tplErr } = await admin
      .from('message_templates')
      .select('account_id, name')
      .in('name', [AGENDA_TEMPLATE_NAME, GENERIC_AGENDA_TEMPLATE_NAME])
      .eq('status', 'APPROVED')
      .in('account_id', [...new Set(apptsWithAgenda.map((r) => r.account_id))]);
    if (tplErr) {
      console.warn(
        '[Reminder Cron] agenda template lookup failed, using base template:',
        tplErr
      );
    }
    for (const t of agendaTemplates || []) {
      const set =
        t.name === AGENDA_TEMPLATE_NAME
          ? siteVisitAgendaAccounts
          : genericAgendaAccounts;
      set.add(t.account_id as string);
    }
  }

  for (const appt of rows) {
    const msUntilStart = new Date(appt.start_time).getTime() - now.getTime();
    const isDue1h = !appt.reminder_1h_sent && msUntilStart <= HOUR_MS;
    // Morning-of brief: fires once the 7 AM IST window opens, for
    // today's events still more than an hour away (the 1h reminder
    // covers anything closer — two near-identical messages back to
    // back reads spammy).
    const isDueMorning =
      !appt.reminder_morning_sent &&
      morningWindowOpen &&
      msUntilStart > HOUR_MS &&
      new Date(appt.start_time).getTime() < dayEndMs;

    const isSiteVisit = appt.event_type === 'site_visit';
    const useAgendaTemplate = isSiteVisit
      ? siteVisitAgendaAccounts.has(appt.account_id)
      : genericAgendaAccounts.has(appt.account_id);

    if (isDue1h) {
      const contactsCovered = await sendToAllRecipients(
        admin,
        appt,
        contacts,
        '1h',
        isSiteVisit,
        useAgendaTemplate
      );
      const liaisonCovered = await sendLiaisonReminder(
        admin,
        appt,
        '1h',
        isSiteVisit,
        liaisonWaCache
      );
      if (contactsCovered && liaisonCovered) {
        // An event that got its 1h reminder no longer needs the
        // morning one — mark both so it drops out of the scan.
        await admin
          .from('appointments')
          .update({ reminder_1h_sent: true, reminder_morning_sent: true })
          .eq('id', appt.id);
      }
    } else if (isDueMorning) {
      const contactsCovered = await sendToAllRecipients(
        admin,
        appt,
        contacts,
        'morning',
        isSiteVisit,
        useAgendaTemplate
      );
      const liaisonCovered = await sendLiaisonReminder(
        admin,
        appt,
        'morning',
        isSiteVisit,
        liaisonWaCache
      );
      if (contactsCovered && liaisonCovered) {
        await admin
          .from('appointments')
          .update({ reminder_morning_sent: true })
          .eq('id', appt.id);
      }
    }
  }
}
