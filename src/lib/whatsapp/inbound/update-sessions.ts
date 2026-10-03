import { phonesMatch } from '@/lib/whatsapp/phone-utils';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { supabaseAdmin } from '@/lib/supabase/admin';

// ============================================================
// Update Intent Handlers
// ============================================================

interface UpdateField {
  name: string;
  label: string;
  type: 'text' | 'number' | 'select';
  options?: string[];
  current_value?: string;
}

const PROPERTY_UPDATABLE_FIELDS: UpdateField[] = [
  { name: 'title', label: 'Title', type: 'text' },
  { name: 'price', label: 'Price (INR)', type: 'number' },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    options: ['Available', 'Sold', 'Rented', 'Under Contract', 'Withdrawn'],
  },
  { name: 'bedrooms', label: 'Bedrooms', type: 'number' },
  { name: 'bathrooms', label: 'Bathrooms', type: 'number' },
  { name: 'area_sqft', label: 'Area (Sq.Ft.)', type: 'number' },
  { name: 'location', label: 'Location', type: 'text' },
  { name: 'description', label: 'Description', type: 'text' },
];

const CONTACT_UPDATABLE_FIELDS: UpdateField[] = [
  { name: 'name', label: 'Name', type: 'text' },
  { name: 'email', label: 'Email', type: 'text' },
  {
    name: 'classification',
    label: 'Classification',
    type: 'select',
    options: [
      'Buyer',
      'Seller',
      'Agent',
      'Owner',
      'Owner & Buyer',
      'Developer',
      'Others',
    ],
  },
  { name: 'budget_min', label: 'Budget Min (INR)', type: 'number' },
  { name: 'budget_max', label: 'Budget Max (INR)', type: 'number' },
  { name: 'preferred_location', label: 'Preferred Location', type: 'text' },
];

export function parseUpdateIntent(text: string): {
  type: 'property' | 'contact' | null;
  identifier?: string;
} | null {
  const cleaned = text.trim().toLowerCase();

  // Match patterns like "update property PROP-1018", "update contact", "update PROP-1018"
  const propertyWithCode = /\bupdate\s+(?:property\s+)?(prop-?\d+)\b/i.exec(
    cleaned
  );
  if (propertyWithCode) {
    return { type: 'property', identifier: propertyWithCode[1].toUpperCase() };
  }

  const propertyGeneric = /\bupdate\s+property\b/i.test(cleaned);
  if (propertyGeneric) {
    return { type: 'property' };
  }

  const contactUpdate = /\bupdate\s+contact\b/i.test(cleaned);
  if (contactUpdate) {
    return { type: 'contact' };
  }

  // Generic "update" might default to contact update for the current conversation
  const genericUpdate = /^update$/i.test(cleaned);
  if (genericUpdate) {
    return { type: 'contact' };
  }

  return null;
}

// Org roles (org_manager > org_leader > org_coordinator > org_agent) are the
// source of truth; account_role (owner/admin/coordinator/agent/viewer) is the
// legacy mirror kept in lockstep by a trigger: owner↔org_manager,
// admin↔org_leader, coordinator↔org_coordinator, agent↔org_agent, viewer→org_agent.
// Managers, leaders, coordinators, and agents may update.
// Agents (and coordinators) are matched via account_role rather than org_role
// ON PURPOSE: viewers collapse to org_agent too (with is_read_only), so
// org_agent cannot distinguish an agent from a read-only viewer. Do NOT add
// 'org_agent' to the org-role set — it would let viewers mutate records.
// (Coordinator is safe on the account_role side: it's a distinct value and is
// never read-only.)
const UPDATE_STAFF_ACCOUNT_ROLES = ['owner', 'admin', 'coordinator', 'agent'];

const UPDATE_STAFF_ORG_ROLES = ['org_manager', 'org_leader'];

/**
 * Account staff who may update ANY property or contact over WhatsApp:
 * managers, leaders, and agents (via the role sets above). Matched by the
 * sender's phone against a staff profile on the same account. Non-staff
 * senders can still update a specific record they own — see
 * isAuthorizedForUpdateSession / the owner checks in the intent handlers.
 */
async function isUpdateStaffSender(
  senderPhone: string,
  accountId: string
): Promise<boolean> {
  try {
    const { data: staffProfiles, error } = await supabaseAdmin()
      .from('profiles')
      .select('phone, account_role, org_role')
      .eq('account_id', accountId)
      .or(
        `account_role.in.(${UPDATE_STAFF_ACCOUNT_ROLES.join(',')}),org_role.in.(${UPDATE_STAFF_ORG_ROLES.join(',')})`
      );

    if (error || !staffProfiles || staffProfiles.length === 0) {
      if (error) {
        console.error(
          '[webhook] Error querying staff profiles for update authorization:',
          error
        );
      }
      return false;
    }

    return staffProfiles.some(
      (p: { phone: string | null }) =>
        p.phone && phonesMatch(p.phone, senderPhone)
    );
  } catch (err) {
    console.error('[webhook] Exception in isUpdateStaffSender:', err);
    return false;
  }
}

/**
 * Authorize an inbound sender to continue an in-progress update session.
 * A session is owned by the sender when it targets their own contact
 * record, or a property they listed (properties.owner_contact_id). Staff
 * may act on any session. Guards pre-existing sessions and any session
 * whose ownership must be re-verified on each incoming message.
 */
export async function isAuthorizedForUpdateSession(
  session: { update_type: string; target_id: string },
  contactRecord: { id: string },
  senderPhone: string,
  accountId: string
): Promise<boolean> {
  if (session.update_type === 'contact') {
    if (session.target_id === contactRecord.id) return true;
  } else if (session.update_type === 'property') {
    const { data: prop } = await supabaseAdmin()
      .from('properties')
      .select('owner_contact_id')
      .eq('id', session.target_id)
      .eq('account_id', accountId)
      .maybeSingle();
    if (
      prop &&
      prop.owner_contact_id &&
      prop.owner_contact_id === contactRecord.id
    ) {
      return true;
    }
  }
  return isUpdateStaffSender(senderPhone, accountId);
}

// Handle incoming update intent
export async function handleUpdateIntent(
  intent: { type: 'property' | 'contact'; identifier?: string },
  accountId: string,
  configOwnerUserId: string,
  contactRecord: { id: string; name?: string; phone: string },
  conversation: { id: string },
  senderPhone: string
): Promise<boolean> {
  try {
    // Check for existing active update session
    const { data: existingSession } = await supabaseAdmin()
      .from('update_sessions')
      .select('*')
      .eq('contact_id', contactRecord.id)
      .eq('status', 'collecting')
      .maybeSingle();

    if (existingSession) {
      await sendWhatsAppMessageAndPersist({
        accountId,
        userId: configOwnerUserId,
        contactId: contactRecord.id,
        conversationId: conversation.id,
        toPhone: senderPhone,
        kind: 'text',
        text: `You have an ongoing update session. Please complete or cancel it first by sending "cancel".`,
        senderType: 'bot',
      });
      return true;
    }

    if (intent.type === 'property') {
      return await handlePropertyUpdateIntent(
        intent.identifier,
        accountId,
        configOwnerUserId,
        contactRecord,
        conversation,
        senderPhone
      );
    }
    return await handleContactUpdateIntent(
      accountId,
      configOwnerUserId,
      contactRecord,
      conversation,
      senderPhone
    );
  } catch (err) {
    console.error('[webhook] Failed to handle update intent:', err);
    await sendWhatsAppMessageAndPersist({
      accountId,
      userId: configOwnerUserId,
      contactId: contactRecord.id,
      conversationId: conversation.id,
      toPhone: senderPhone,
      kind: 'text',
      text: 'Sorry, something went wrong. Please try again.',
      senderType: 'bot',
    });
    return true;
  }
}

// Handle property update intent
async function handlePropertyUpdateIntent(
  identifier: string | undefined,
  accountId: string,
  configOwnerUserId: string,
  contactRecord: { id: string; name?: string; phone: string },
  conversation: { id: string },
  senderPhone: string
): Promise<boolean> {
  let property = null;

  if (identifier) {
    // Find property by code
    const { data } = await supabaseAdmin()
      .from('properties')
      .select('*')
      .eq('account_id', accountId)
      .ilike('property_code', identifier)
      .maybeSingle();
    property = data;
  } else {
    // Find the last property this contact inquired about
    const contactWithProp = contactRecord as {
      id: string;
      name?: string;
      phone: string;
      last_inquired_property_id?: string;
    };
    if (contactWithProp.last_inquired_property_id) {
      const { data } = await supabaseAdmin()
        .from('properties')
        .select('*')
        .eq('account_id', accountId)
        .eq('id', contactWithProp.last_inquired_property_id)
        .maybeSingle();
      property = data;
    }
  }

  if (!property) {
    // Only reveal that a property does or doesn't exist to account staff;
    // for everyone else fall through silently so the feature stays hidden.
    if (!(await isUpdateStaffSender(senderPhone, accountId))) return false;
    await sendWhatsAppMessageAndPersist({
      accountId,
      userId: configOwnerUserId,
      contactId: contactRecord.id,
      conversationId: conversation.id,
      toPhone: senderPhone,
      kind: 'text',
      text: identifier
        ? `I couldn't find a property with code "${identifier}". Please check the property code and try again.`
        : `I couldn't find a property associated with your account. Please specify the property code (e.g., "Update Property PROP-1018").`,
      senderType: 'bot',
    });
    return true;
  }

  // Authorize: account staff may update any property; a non-staff sender
  // may only update a property they listed over WhatsApp
  // (properties.owner_contact_id). Unauthorized senders fall through.
  const isOwner =
    property.owner_contact_id != null &&
    property.owner_contact_id === contactRecord.id;
  if (!isOwner && !(await isUpdateStaffSender(senderPhone, accountId))) {
    return false;
  }

  // Create update session
  const pendingFields = PROPERTY_UPDATABLE_FIELDS.map((f) => f.name);

  await supabaseAdmin()
    .from('update_sessions')
    .insert({
      account_id: accountId,
      contact_id: contactRecord.id,
      update_type: 'property',
      target_id: property.id,
      target_identifier: property.property_code || property.id,
      collected_fields: {},
      pending_fields: pendingFields,
      status: 'collecting',
    });

  // Ask for first field
  await sendWhatsAppMessageAndPersist({
    accountId,
    userId: configOwnerUserId,
    contactId: contactRecord.id,
    conversationId: conversation.id,
    toPhone: senderPhone,
    kind: 'text',
    text: `Let's update *${property.title || property.property_code}*\n\nCurrent values:\n${PROPERTY_UPDATABLE_FIELDS.map((f) => `• ${f.label}: ${property[f.name] || 'not set'}`).join('\n')}\n\nWhat would you like to update?\n\nSend the field name (e.g., "price", "status", "title") or send "all" to update fields one by one.`,
    senderType: 'bot',
  });
  return true;
}

// Handle contact update intent
async function handleContactUpdateIntent(
  accountId: string,
  configOwnerUserId: string,
  contactRecord: { id: string; name?: string; phone: string },
  conversation: { id: string },
  senderPhone: string
): Promise<boolean> {
  // The contact update always targets the sender's own contact record, so
  // the sender is by definition the owner of what they're editing.
  // Create update session for contact
  const pendingFields = CONTACT_UPDATABLE_FIELDS.map((f) => f.name);

  await supabaseAdmin().from('update_sessions').insert({
    account_id: accountId,
    contact_id: contactRecord.id,
    update_type: 'contact',
    target_id: contactRecord.id,
    target_identifier: contactRecord.phone,
    collected_fields: {},
    pending_fields: pendingFields,
    status: 'collecting',
  });

  // Ask for first field
  await sendWhatsAppMessageAndPersist({
    accountId,
    userId: configOwnerUserId,
    contactId: contactRecord.id,
    conversationId: conversation.id,
    toPhone: senderPhone,
    kind: 'text',
    text: `Let's update your contact details\n\nCurrent values:\n${CONTACT_UPDATABLE_FIELDS.map((f) => `• ${f.label}: ${(contactRecord as Record<string, unknown>)[f.name] || 'not set'}`).join('\n')}\n\nWhat would you like to update?\n\nSend the field name (e.g., "name", "email", "classification") or send "all" to update fields one by one.`,
    senderType: 'bot',
  });
  return true;
}

// Handle update session input
export async function handleUpdateSessionInput(
  sessionId: string,
  text: string,
  accountId: string,
  configOwnerUserId: string,
  contactRecord: { id: string; name?: string; phone: string },
  conversation: { id: string },
  senderPhone: string
) {
  const { data: session } = await supabaseAdmin()
    .from('update_sessions')
    .select('*')
    .eq('id', sessionId)
    .maybeSingle();

  if (!session) return false;

  const cleanedText = text.trim().toLowerCase();

  // Handle cancel
  if (cleanedText === 'cancel') {
    await supabaseAdmin()
      .from('update_sessions')
      .update({ status: 'cancelled' })
      .eq('id', sessionId);

    await sendWhatsAppMessageAndPersist({
      accountId,
      userId: configOwnerUserId,
      contactId: contactRecord.id,
      conversationId: conversation.id,
      toPhone: senderPhone,
      kind: 'text',
      text: 'Update cancelled.',
      senderType: 'bot',
    });
    return true;
  }

  // Handle "all" to start field-by-field update
  if (cleanedText === 'all') {
    const fields =
      session.update_type === 'property'
        ? PROPERTY_UPDATABLE_FIELDS
        : CONTACT_UPDATABLE_FIELDS;
    const firstField = fields[0];

    await supabaseAdmin()
      .from('update_sessions')
      .update({
        pending_fields: fields.map((f) => f.name),
        status: 'collecting',
      })
      .eq('id', sessionId);

    await sendWhatsAppMessageAndPersist({
      accountId,
      userId: configOwnerUserId,
      contactId: contactRecord.id,
      conversationId: conversation.id,
      toPhone: senderPhone,
      kind: 'text',
      text: `Let's update fields one by one.\n\nEnter new value for *${firstField.label}*:\n(current: ${firstField.current_value || 'not set'})\n\nSend "skip" to skip this field.`,
      senderType: 'bot',
    });
    return true;
  }

  // Handle field-specific update (e.g., "price 1.5cr", "status sold")
  const fieldMatch = /^(\w+)\s+(.+)$/m.exec(text.trim());
  if (fieldMatch) {
    const [, fieldName, value] = fieldMatch;
    const fields =
      session.update_type === 'property'
        ? PROPERTY_UPDATABLE_FIELDS
        : CONTACT_UPDATABLE_FIELDS;
    const field = fields.find(
      (f) => f.name.toLowerCase() === fieldName.toLowerCase()
    );

    if (!field) {
      await sendWhatsAppMessageAndPersist({
        accountId,
        userId: configOwnerUserId,
        contactId: contactRecord.id,
        conversationId: conversation.id,
        toPhone: senderPhone,
        kind: 'text',
        text: `Invalid field "${fieldName}". Available fields: ${fields.map((f) => f.name).join(', ')}`,
        senderType: 'bot',
      });
      return true;
    }

    // Validate select fields
    if (field.type === 'select' && field.options) {
      const validOption = field.options.find(
        (o) => o.toLowerCase() === value.toLowerCase()
      );
      if (!validOption) {
        await sendWhatsAppMessageAndPersist({
          accountId,
          userId: configOwnerUserId,
          contactId: contactRecord.id,
          conversationId: conversation.id,
          toPhone: senderPhone,
          kind: 'text',
          text: `Invalid value "${value}". Choose from: ${field.options.join(', ')}`,
          senderType: 'bot',
        });
        return true;
      }
    }

    // Update the field
    const updateData: Record<string, unknown> = {};
    if (session.update_type === 'property') {
      updateData[field.name] =
        field.type === 'number' ? Number(value) || value : value;
      await supabaseAdmin()
        .from('properties')
        .update(updateData)
        .eq('id', session.target_id);
    } else {
      updateData[field.name] =
        field.type === 'number' ? Number(value) || value : value;
      await supabaseAdmin()
        .from('contacts')
        .update(updateData)
        .eq('id', session.target_id);
    }

    // Remove field from pending
    const remainingFields = (session.pending_fields as string[]).filter(
      (f) => f !== field.name
    );

    if (remainingFields.length === 0) {
      // All fields updated
      await supabaseAdmin()
        .from('update_sessions')
        .update({
          status: 'completed',
          pending_fields: [],
          collected_fields: {
            ...session.collected_fields,
            [field.name]: value,
          },
        })
        .eq('id', sessionId);

      await sendWhatsAppMessageAndPersist({
        accountId,
        userId: configOwnerUserId,
        contactId: contactRecord.id,
        conversationId: conversation.id,
        toPhone: senderPhone,
        kind: 'text',
        text: `✅ Updated *${field.label}* to "${value}"\n\nAll done! Your ${session.update_type} has been updated.`,
        senderType: 'bot',
      });
    } else {
      // More fields to update
      await supabaseAdmin()
        .from('update_sessions')
        .update({
          pending_fields: remainingFields,
          collected_fields: {
            ...session.collected_fields,
            [field.name]: value,
          },
        })
        .eq('id', sessionId);

      const nextField = fields.find((f) => f.name === remainingFields[0]);
      await sendWhatsAppMessageAndPersist({
        accountId,
        userId: configOwnerUserId,
        contactId: contactRecord.id,
        conversationId: conversation.id,
        toPhone: senderPhone,
        kind: 'text',
        text: `✅ Updated *${field.label}* to "${value}"\n\nEnter new value for *${nextField?.label || remainingFields[0]}*:\nSend "skip" to skip, or "done" to finish.`,
        senderType: 'bot',
      });
    }
    return true;
  }

  // If we're in collecting mode and no field specified, show available fields
  const fields =
    session.update_type === 'property'
      ? PROPERTY_UPDATABLE_FIELDS
      : CONTACT_UPDATABLE_FIELDS;
  await sendWhatsAppMessageAndPersist({
    accountId,
    userId: configOwnerUserId,
    contactId: contactRecord.id,
    conversationId: conversation.id,
    toPhone: senderPhone,
    kind: 'text',
    text: `Please specify the field and value.\n\nExamples:\n• "price 1.5cr"\n• "status sold"\n• "title New Title"\n\nAvailable fields: ${fields.map((f) => f.name).join(', ')}\n\nOr send "all" to update fields one by one.`,
    senderType: 'bot',
  });
  return true;
}
