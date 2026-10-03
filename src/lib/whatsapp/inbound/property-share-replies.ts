import { sendListingFeedbackPrompt } from '@/lib/whatsapp/listing-feedback';
import { accountPropertyShowcaseUrl } from '@/lib/showcase/account-showcase-url';
import { isLocationGuarded } from '@/lib/inventory/location-guard';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { buildSoldPriceReply } from '@/lib/whatsapp/sold-notification';
import { buildPropertyInterestQuestion } from '@/lib/whatsapp/property-interest';
import { logPropertyShare } from '@/lib/whatsapp/share-property-send';
import { formatCurrency, formatInrCompact } from '@/lib/format/currency';
import type { PropertyRow } from '@/lib/whatsapp/webhook-handler';

export async function handlePropertyShareYesReply(
  propertyId: string,
  accountId: string,
  configOwnerUserId: string,
  contactId: string,
  conversationId: string,
  toPhone: string,
  options: { followUp?: 'feedback' | 'questions' | 'none' } = {}
): Promise<boolean> {
  try {
    const { data: property, error } = await supabaseAdmin()
      .from('properties')
      .select('*')
      .eq('id', propertyId)
      .eq('account_id', accountId)
      .maybeSingle();

    const typedProperty = property as PropertyRow | null;

    if (error || !typedProperty) {
      console.error(
        '[webhook] Property not found for share yes reply:',
        propertyId,
        error
      );
      return false;
    }

    let currency = 'INR';
    const { data: settings } = await supabaseAdmin()
      .from('showcase_settings')
      .select('currency')
      .eq('account_id', accountId)
      .maybeSingle();
    if (settings?.currency) {
      currency = settings.currency;
    }

    const amount = Number(typedProperty.price);
    let formattedPrice = '';
    if (!isNaN(amount) && amount > 0) {
      formattedPrice = formatCurrency(amount, currency);
    }

    const isLand =
      typedProperty.type?.includes('Land') ||
      typedProperty.type?.includes('Plot');
    const areaVal = isLand ? typedProperty.land_area : typedProperty.area_sqft;
    const unitVal = isLand
      ? typedProperty.land_area_unit
      : typedProperty.area_unit;
    const areaStr = areaVal ? `${areaVal} ${unitVal || 'Sq.Ft.'}` : '';

    const propertyGuarded = isLocationGuarded({
      type: typedProperty.type || '',
      location_privacy: typedProperty.location_privacy,
    });
    const locationParts =
      [typedProperty.sublocality?.trim(), typedProperty.city?.trim()]
        .filter(Boolean)
        .join(', ') || (propertyGuarded ? '' : typedProperty.location);

    // The account's own showcase (its subdomain when it has one) and
    // the listing's property code — same link the manual share builds,
    // rather than an unbranded convoreal.com/?property_id=<uuid>.
    // v= attributes Showcase Pulse engagement to this contact (never filters)
    const showcaseUrl = await accountPropertyShowcaseUrl(
      supabaseAdmin(),
      accountId,
      typedProperty,
      contactId
    );

    let detailsText = `🏠 *${typedProperty.title}*\n`;
    if (formattedPrice) detailsText += `💰 *Price:* ${formattedPrice}\n`;
    if (locationParts) detailsText += `📍 *Location:* ${locationParts}\n`;
    if (areaStr) detailsText += `📐 *Area:* ${areaStr}\n`;
    if (typedProperty.bedrooms)
      detailsText += `🛏️ *BHK:* ${typedProperty.bedrooms} BHK\n`;
    if (typedProperty.bathrooms)
      detailsText += `🛁 *Bathrooms:* ${typedProperty.bathrooms}\n`;
    if (typedProperty.description)
      detailsText += `\n📝 *Description:*\n${typedProperty.description}\n`;

    if (typedProperty.google_map_link && !propertyGuarded) {
      detailsText += `\n🗺️ *Google Maps:* ${typedProperty.google_map_link}\n`;
    }
    detailsText += `\n👇 *Click the link below to view photos, location map, and full details:*\n${showcaseUrl}`;

    const firstImage = typedProperty.images?.find(
      (img: string) => img.trim().length > 0
    );
    if (firstImage) {
      await sendWhatsAppMessageAndPersist({
        accountId,
        userId: configOwnerUserId,
        contactId,
        conversationId,
        toPhone,
        kind: 'media',
        mediaKind: 'image',
        mediaLink: firstImage,
        mediaCaption: `Showcase image for ${typedProperty.title}`,
        senderType: 'bot',
      });
    }

    // Send property details
    const detailsResult = await sendWhatsAppMessageAndPersist({
      accountId,
      userId: configOwnerUserId,
      contactId,
      conversationId,
      toPhone,
      kind: 'text',
      text: detailsText,
      senderType: 'bot',
    });
    if (!detailsResult.success) {
      console.error(
        '[webhook] Property details send failed:',
        propertyId,
        detailsResult.error
      );
      return false;
    }

    await logPropertyShare(
      supabaseAdmin(),
      accountId,
      configOwnerUserId,
      propertyId,
      contactId
    );

    const followUp = options.followUp ?? 'feedback';
    if (followUp === 'questions') {
      await sendWhatsAppMessageAndPersist({
        accountId,
        userId: configOwnerUserId,
        contactId,
        conversationId,
        toPhone,
        kind: 'text',
        text: buildPropertyInterestQuestion(),
        senderType: 'bot',
      });
      console.log(
        `[webhook] Successfully shared property ${propertyId} with contact ${contactId}`
      );
      return true;
    }

    if (followUp === 'none') return true;

    // This is the first confirmed reply after an out-of-window template.
    // Ask for explicit listing feedback now that WhatsApp permits a
    // free-form interactive message. Explore actions stay in the same
    // list so the previous browse path remains available.
    const feedbackSent = await sendListingFeedbackPrompt({
      db: supabaseAdmin(),
      accountId,
      userId: configOwnerUserId,
      contactId,
      conversationId,
      matches: [{ property: typedProperty }],
      includeFormRow: true,
      includeExploreRows: true,
      sourcePropertyId: typedProperty.id,
    });

    // Preserve the old browse controls if the richer feedback prompt
    // cannot be delivered for any reason.
    if (!feedbackSent) {
      await sendWhatsAppMessageAndPersist({
        accountId,
        userId: configOwnerUserId,
        contactId,
        conversationId,
        toPhone,
        kind: 'interactive',
        interactiveType: 'buttons',
        interactiveBody: 'Would you like to explore other properties?',
        interactiveButtons: [
          {
            id: `show_more_properties:${typedProperty.id}`,
            title: 'Show More Properties',
          },
          { id: 'browse_all_properties', title: 'Browse All' },
          { id: `share_property_no:${typedProperty.id}`, title: 'No Thanks' },
        ],
        senderType: 'bot',
      });
    }

    console.log(
      `[webhook] Successfully shared property ${propertyId} with contact ${contactId}`
    );
    return true;
  } catch (err) {
    console.error('[webhook] Failed in handlePropertyShareYesReply:', err);
    return false;
  }
}

export async function handlePropertyShareNoReply(
  propertyId: string,
  accountId: string,
  configOwnerUserId: string,
  contactId: string,
  conversationId: string,
  toPhone: string
) {
  try {
    const politeMessage = `No problem! If you would like to explore our other listings anytime, tap the button below.`;
    await sendWhatsAppMessageAndPersist({
      accountId,
      userId: configOwnerUserId,
      contactId,
      conversationId,
      toPhone,
      kind: 'interactive',
      interactiveType: 'buttons',
      interactiveBody: politeMessage,
      interactiveButtons: [
        { id: 'browse_all_properties', title: 'Browse Properties' },
      ],
      senderType: 'bot',
    });
    console.log(`[webhook] Handled share no reply for contact ${contactId}`);
  } catch (err) {
    console.error('[webhook] Failed in handlePropertyShareNoReply:', err);
  }
}

export async function handleBrowseAllProperties(
  accountId: string,
  configOwnerUserId: string,
  contactId: string,
  conversationId: string,
  toPhone: string
) {
  try {
    const { data: properties, error } = await supabaseAdmin()
      .from('properties')
      .select('*')
      .eq('account_id', accountId)
      .eq('is_published', true)
      .order('created_at', { ascending: false })
      .limit(10);

    const typedProperties = properties as PropertyRow[] | null;

    if (error || !typedProperties || typedProperties.length === 0) {
      await sendWhatsAppMessageAndPersist({
        accountId,
        userId: configOwnerUserId,
        contactId,
        conversationId,
        toPhone,
        kind: 'text',
        text: `We don't have any other active listings at the moment. Please check back later!`,
        senderType: 'bot',
      });
      return;
    }

    const rows = typedProperties.map((prop) => {
      let priceStr = '';
      const amount = Number(prop.price);
      if (!isNaN(amount) && amount > 0) {
        priceStr = formatInrCompact(amount);
      }

      const areaStr = prop.area_sqft
        ? `${prop.area_sqft} ${prop.area_unit || 'Sq.Ft.'}`
        : '';
      const details = [
        priceStr,
        areaStr,
        prop.bedrooms ? `${prop.bedrooms} BHK` : '',
      ]
        .filter(Boolean)
        .join(' | ');

      return {
        id: `share_property_yes:${prop.id}`,
        title: prop.title.substring(0, 24),
        description: details.substring(0, 72),
      };
    });

    await sendWhatsAppMessageAndPersist({
      accountId,
      userId: configOwnerUserId,
      contactId,
      conversationId,
      toPhone,
      kind: 'interactive',
      interactiveType: 'list',
      interactiveBody: `Explore our top available properties below. Tap a property to see full details and photos.`,
      interactiveButtonLabel: `View Properties`,
      interactiveSections: [
        {
          title: `Active Listings`,
          rows,
        },
      ],
      senderType: 'bot',
    });

    console.log(
      `[webhook] Sent interactive browse list to contact ${contactId}`
    );
  } catch (err) {
    console.error('[webhook] Failed to handle browse all properties:', err);
  }
}

// ============================================================
// Sold Price Reveal Handler
// ============================================================

export async function handleSoldPriceReply(
  propertyId: string,
  accountId: string,
  configOwnerUserId: string,
  contactId: string,
  conversationId: string,
  toPhone: string
) {
  try {
    const { data: property } = await supabaseAdmin()
      .from('properties')
      .select('title, sold_price')
      .eq('id', propertyId)
      .eq('account_id', accountId)
      .maybeSingle();

    if (!property) {
      console.error(
        '[webhook] Property not found for sold price reply:',
        propertyId
      );
      return;
    }

    let currency = 'INR';
    const { data: settings } = await supabaseAdmin()
      .from('showcase_settings')
      .select('currency')
      .eq('account_id', accountId)
      .maybeSingle();
    if (settings?.currency) {
      currency = settings.currency;
    }

    await sendWhatsAppMessageAndPersist({
      accountId,
      userId: configOwnerUserId,
      contactId,
      conversationId,
      toPhone,
      kind: 'text',
      text: buildSoldPriceReply(
        (property.title as string) || 'This property',
        property.sold_price as number | null,
        currency
      ),
      senderType: 'bot',
    });
  } catch (err) {
    console.error('[webhook] Failed in handleSoldPriceReply:', err);
  }
}

// ============================================================
// Show More Properties Handler
// ============================================================

export async function handleShowMoreProperties(
  currentPropertyId: string,
  accountId: string,
  configOwnerUserId: string,
  contactId: string,
  conversationId: string,
  toPhone: string
) {
  try {
    // Get current property to find similar ones
    const { data: currentProperty } = await supabaseAdmin()
      .from('properties')
      .select('*')
      .eq('id', currentPropertyId)
      .eq('account_id', accountId)
      .maybeSingle();

    if (!currentProperty) {
      console.error(
        '[webhook] Current property not found for show more:',
        currentPropertyId
      );
      return;
    }

    // Find similar properties based on type, location, or price range
    const price = Number(currentProperty.price) || 0;
    const minPrice = price * 0.7; // 30% below
    const maxPrice = price * 1.3; // 30% above

    const { data: similarProperties, error } = await supabaseAdmin()
      .from('properties')
      .select('*')
      .eq('account_id', accountId)
      .eq('is_published', true)
      .neq('id', currentPropertyId) // Exclude current property
      .or(
        `type.eq.${currentProperty.type},and(price.gte.${minPrice},price.lte.${maxPrice})`
      )
      .order('created_at', { ascending: false })
      .limit(5);

    if (error || !similarProperties || similarProperties.length === 0) {
      // No similar properties, fall back to browse all
      await handleBrowseAllProperties(
        accountId,
        configOwnerUserId,
        contactId,
        conversationId,
        toPhone
      );
      return;
    }

    // Send properties one by one
    let currency = 'INR';
    const { data: settings } = await supabaseAdmin()
      .from('showcase_settings')
      .select('currency')
      .eq('account_id', accountId)
      .maybeSingle();
    if (settings?.currency) {
      currency = settings.currency;
    }

    // Send intro message
    await sendWhatsAppMessageAndPersist({
      accountId,
      userId: configOwnerUserId,
      contactId,
      conversationId,
      toPhone,
      kind: 'text',
      text: `Here are ${similarProperties.length} similar properties you might like:`,
      senderType: 'bot',
    });

    // Send each property
    for (const prop of similarProperties) {
      const typedProp = prop as PropertyRow;

      const amount = Number(typedProp.price);
      let formattedPrice = '';
      if (!isNaN(amount) && amount > 0) {
        formattedPrice = formatCurrency(amount, currency);
      }

      const isLand =
        typedProp.type?.includes('Land') || typedProp.type?.includes('Plot');
      const areaVal = isLand ? typedProp.land_area : typedProp.area_sqft;
      const unitVal = isLand ? typedProp.land_area_unit : typedProp.area_unit;
      const areaStr = areaVal ? `${areaVal} ${unitVal || 'Sq.Ft.'}` : '';

      const locationParts =
        [typedProp.sublocality?.trim(), typedProp.city?.trim()]
          .filter(Boolean)
          .join(', ') ||
        (isLocationGuarded({
          type: typedProp.type || '',
          location_privacy: typedProp.location_privacy,
        })
          ? ''
          : typedProp.location);

      // Account showcase + property code, as the manual share builds.
      // v= attributes Showcase Pulse engagement to this contact (never filters)
      const showcaseUrl = await accountPropertyShowcaseUrl(
        supabaseAdmin(),
        accountId,
        typedProp,
        contactId
      );

      // Send image first
      const firstImage = typedProp.images?.find(
        (img: string) => img.trim().length > 0
      );
      if (firstImage) {
        await sendWhatsAppMessageAndPersist({
          accountId,
          userId: configOwnerUserId,
          contactId,
          conversationId,
          toPhone,
          kind: 'media',
          mediaKind: 'image',
          mediaLink: firstImage,
          mediaCaption: typedProp.title,
          senderType: 'bot',
        });
      }

      // Send details
      let detailsText = `🏠 *${typedProp.title}*\n`;
      if (formattedPrice) detailsText += `💰 *Price:* ${formattedPrice}\n`;
      if (locationParts) detailsText += `📍 *Location:* ${locationParts}\n`;
      if (areaStr) detailsText += `📐 *Area:* ${areaStr}\n`;
      if (typedProp.bedrooms)
        detailsText += `🛏️ *BHK:* ${typedProp.bedrooms} BHK\n`;
      detailsText += `\n👇 *Click the link below to view photos, location map, and full details:*\n${showcaseUrl}`;

      await sendWhatsAppMessageAndPersist({
        accountId,
        userId: configOwnerUserId,
        contactId,
        conversationId,
        toPhone,
        kind: 'text',
        text: detailsText,
        senderType: 'bot',
      });
    }

    // Final follow-up with options
    await sendWhatsAppMessageAndPersist({
      accountId,
      userId: configOwnerUserId,
      contactId,
      conversationId,
      toPhone,
      kind: 'interactive',
      interactiveType: 'buttons',
      interactiveBody: `Would you like to see more properties or get in touch?`,
      interactiveButtons: [
        {
          id: `show_more_properties:${similarProperties[similarProperties.length - 1].id}`,
          title: 'Show More',
        },
        { id: 'browse_all_properties', title: 'Browse All' },
      ],
      senderType: 'bot',
    });

    console.log(
      `[webhook] Sent ${similarProperties.length} similar properties to contact ${contactId}`
    );
  } catch (err) {
    console.error('[webhook] Failed in handleShowMoreProperties:', err);
  }
}
