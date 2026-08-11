/**
 * Copilot knowledge corpus.
 *
 * Every fact the helper is allowed to state lives here as a small,
 * independently retrievable chunk. The prompt no longer carries the
 * whole knowledge base: retrieval.ts picks the chunks relevant to the
 * question, so coverage can grow without growing the per-question
 * token bill.
 *
 * Kinds:
 *  - page:    what a dashboard route is for. Exactly these routes are
 *             navigateTo targets, and chunks.test.ts fails CI when a
 *             dashboard route ships without one.
 *  - concept: a cross-cutting idea (credits, the 24-hour window,
 *             matching) that no single page owns.
 *  - howto:   task recipes NOT covered by a guided tour — the tour
 *             registry stays the answer for tour-covered tasks.
 *  - limit:   things ConvoReal cannot do, stated plainly, each with
 *             the nearest supported alternative. Grounds "we don't do
 *             that" answers and keeps `unsupported` phrasing
 *             consistent. Source new ones from copilot_unmet_requests.
 *
 * Editing a chunk changes its version hash, which retires only the
 * cached answers built on it (see qa-cache.ts). After editing, run
 * `npm run copilot:index` to refresh semantic retrieval.
 */

export type ChunkKind = 'page' | 'concept' | 'howto' | 'limit';

/**
 * Who a chunk is written for. Three products share this corpus and
 * almost nothing crosses between them: an agent runs a brokerage, an
 * owner watches their own listings, a buyer browses matches. A chunk
 * belongs to exactly one audience — say a shared idea twice, in each
 * audience's own words, rather than writing one paragraph that hedges
 * for all three. Retrieval never crosses the boundary, so an owner
 * can't be told about Broadcasts.
 */
export type Audience = 'agent' | 'owner' | 'buyer';

export interface KnowledgeChunk {
  /** Stable id, `area.topic` — cache rows and the index key on it. */
  id: string;
  /** Dashboard route this chunk is anchored to, when one owns it. */
  route?: string;
  title: string;
  /** 2–4 plain sentences, ≤400 chars (enforced by chunks.test.ts). */
  body: string;
  /** Lexical-retrieval hints: synonyms and Hinglish terms not already
   *  in the title or body. Lowercase. */
  keywords?: string[];
  kind: ChunkKind;
  /** Defaults to 'agent' — the staff Engine is the original corpus. */
  audience?: Audience;
}

export function audienceOf(chunk: KnowledgeChunk): Audience {
  return chunk.audience ?? 'agent';
}

export const CHUNKS: KnowledgeChunk[] = [
  // ---- pages -------------------------------------------------
  {
    id: 'dashboard.overview',
    route: '/dashboard',
    title: 'Dashboard',
    kind: 'page',
    body: 'Home screen with four tabs. Overview: key numbers (contacts, properties, deals, messages). Today: daily action list — WhatsApp chats about to close, hot leads going quiet, appointments and to-dos. Match Radar: automatic buyer-to-property matches. Pulse: who viewed your property links, how many times, and for how long.',
    keywords: ['home', 'stats', 'numbers'],
  },
  {
    id: 'inbox.overview',
    route: '/inbox',
    title: 'Inbox',
    kind: 'page',
    body: 'All WhatsApp conversations with your customers in one place. Your whole team replies from one business number. Reply within WhatsApp’s 24-hour window; after it closes you must use an approved template. Unread chats show a dot in the menu.',
    keywords: ['chat', 'messages', 'whatsapp', 'conversations'],
  },
  {
    id: 'groups.overview',
    route: '/groups',
    title: 'Groups',
    kind: 'page',
    body: 'Create and manage WhatsApp groups from ConvoReal (beta). Customers join through an invite link. Group chats appear alongside your other conversations. Available only to numbers with an Official Business Account — the page stays hidden until your number qualifies.',
    keywords: ['whatsapp group', 'community', 'invite link'],
  },
  {
    id: 'contacts.overview',
    route: '/contacts',
    title: 'Contacts',
    kind: 'page',
    body: 'All your leads and customers. Add contacts manually, import them, or let the WhatsApp bot capture them automatically. Each contact stores phone, budget, preferred locations, property type, and a lead temperature (HOT/WARM/COLD). Forwarding a customer’s message card to your own WhatsApp bot also saves them.',
    keywords: ['leads', 'customers', 'buyers'],
  },
  {
    id: 'inventory.overview',
    route: '/inventory',
    title: 'Inventory',
    kind: 'page',
    body: 'Your property listings with price, location, photos and documents. Properties here power buyer matching (Match Radar), your public Showcase portal link, and AI-generated descriptions. Listings sent by other agents arrive under Review for you to approve or reject. Use Share Showcase Portal to send buyers a link to browse your listings.',
    keywords: ['properties', 'listings', 'makaan', 'flat', 'plot'],
  },
  {
    id: 'liaisons.overview',
    route: '/liaisons',
    title: 'Liaisons',
    kind: 'page',
    body: 'A directory of the service providers around your deals — lawyers, khata and registration agents, loan agents, surveyors. Assign them jobs with payments tracked per job, and share step-by-step workflow timelines (loan, registration, khata transfer) with clients so they know what happens next.',
    keywords: [
      'lawyer',
      'khata',
      'registration',
      'loan agent',
      'service provider',
      'vendor',
    ],
  },
  {
    id: 'calendar.overview',
    route: '/calendar',
    title: 'Calendar',
    kind: 'page',
    body: 'Appointments and to-dos. Site visits, follow-up reminders and tasks appear here and in the Today tab. You can link an appointment to a contact and a property. Confirmed appointments send automatic WhatsApp reminders to the customer.',
    keywords: ['appointments', 'site visit', 'todo', 'schedule', 'meeting'],
  },
  {
    id: 'journey.overview',
    route: '/journey',
    title: 'Journey',
    kind: 'page',
    body: 'A visual mind-map of each buyer’s search (beta). Properties you share on WhatsApp are captured onto the customer’s journey automatically, and you can plan next steps with expected timelines. The page lists every journey; open one to see its full map.',
    keywords: ['mind map', 'buyer journey', 'timeline'],
  },
  {
    id: 'automations.overview',
    route: '/automations',
    title: 'Automations',
    kind: 'page',
    body: 'Set-and-forget rules, like auto-replies and follow-up sequences that trigger on events (new lead, keyword, time delay). Each automation has a log showing every run.',
    keywords: ['auto reply', 'rules', 'follow up', 'sequence'],
  },
  {
    id: 'broadcasts.overview',
    route: '/broadcasts',
    title: 'Broadcasts',
    kind: 'page',
    body: 'Send one approved WhatsApp template message to many contacts at once — pick a template, choose the audience (all or by tag), personalise, and send. Delivery and read counts are tracked per broadcast.',
    keywords: ['bulk message', 'campaign', 'mass send', 'sabko bhejo'],
  },
  {
    id: 'pipelines.overview',
    route: '/pipelines',
    title: 'Pipelines',
    kind: 'page',
    body: 'Deal board. Drag deals between stages (new, negotiating, closed) to track every potential sale from first chat to closing. Deals link a contact to a property and carry the deal value and brokerage.',
    keywords: ['deals', 'kanban', 'sales board', 'stages'],
  },
  {
    id: 'flows.overview',
    route: '/flows',
    title: 'Flows',
    kind: 'page',
    body: 'Visual chatbot flow builder — design question-and-answer paths the WhatsApp bot follows with customers. Each flow has a runs view showing how far customers got.',
    keywords: ['chatbot', 'bot builder', 'menu tree'],
  },
  {
    id: 'requirements.overview',
    route: '/requirements',
    title: 'Requirements',
    kind: 'page',
    body: 'Buyer requirements collected from customers (budget, location, property type). These drive Match Radar suggestions. You can share a requirement with other brokers — masked under a code like REQ-A3F2, so they see the brief but never the client’s name — and they send back a matching property, which lands in Inventory under Review.',
    keywords: ['brief', 'buyer requirement', 'req code'],
  },
  {
    id: 'agents.overview',
    route: '/agents',
    title: 'Agents',
    kind: 'page',
    body: 'Other agents you collaborate with, for sharing inventory and requirements. Listings they send you — from a shared requirement, your listing link, or WhatsApp — arrive in Inventory under Review to approve or reject. Answering another broker’s shared brief files them here, building your co-broker network.',
    keywords: ['co-broker', 'broker network', 'collaborators'],
  },
  {
    id: 'ads.overview',
    route: '/ads',
    title: 'Ads',
    kind: 'page',
    body: 'Create and track Meta (Facebook/Instagram) ads for your properties, with AI-written ad copy. Leads who tap a click-to-WhatsApp ad land in your Inbox with the ad recorded as their source.',
    keywords: ['facebook', 'instagram', 'meta ads', 'ctwa'],
  },
  {
    id: 'settings.overview',
    route: '/settings',
    title: 'Settings',
    kind: 'page',
    body: 'Profile, WhatsApp connection and templates, Showcase branding, tags, team members and roles, routing rules, AI credits, billing, notifications, and appearance (light/dark and accent themes). WhatsApp must be connected before Inbox and Broadcasts work.',
    keywords: ['configuration', 'setup', 'theme', 'preferences'],
  },
  {
    id: 'today.overview',
    route: '/today',
    title: 'Today',
    kind: 'page',
    body: 'Your daily action list: WhatsApp chats whose 24-hour reply window is about to close, hot leads going quiet, today’s appointments and to-dos. The same list appears as the Today tab on the Dashboard.',
    keywords: ['agenda', 'daily', 'action list', 'aaj'],
  },
  {
    id: 'radar.overview',
    route: '/radar',
    title: 'Match Radar',
    kind: 'page',
    body: 'Automatic buyer-to-property matches. When a contact’s stored preferences fit a property in your inventory, a match event appears here so you can share the property or start a deal. Also available as the Match Radar tab on the Dashboard.',
    keywords: ['matches', 'suggestions', 'buyer match'],
  },
  {
    id: 'pulse.overview',
    route: '/pulse',
    title: 'Pulse',
    kind: 'page',
    body: 'Engagement feed for your public showcase: who viewed your property links, which properties, how many times, and for how long. Use it to spot which listings and buyers are heating up. Also available as the Pulse tab on the Dashboard.',
    keywords: ['views', 'visitors', 'engagement', 'link tracking'],
  },

  // ---- concepts ----------------------------------------------
  {
    id: 'whatsapp.window',
    title: 'The 24-hour window',
    kind: 'concept',
    body: 'After a customer messages you, WhatsApp allows free-form replies for 24 hours. Once the window closes, only Meta-approved template messages can be sent until the customer writes again. The Today list warns you about chats whose window is about to close.',
    keywords: ['24 hour', 'session', 'free-form', 'window closed'],
  },
  {
    id: 'whatsapp.templates',
    title: 'Message templates',
    kind: 'concept',
    body: 'Templates are pre-approved messages reviewed by Meta before use — needed for broadcasts and for messaging outside the 24-hour window. Create and submit them in Settings → WhatsApp → Templates; approval usually takes minutes to hours. Meta assigns each template a category (UTILITY or MARKETING) that affects pricing.',
    keywords: ['template approval', 'meta review', 'utility', 'marketing'],
  },
  {
    id: 'whatsapp.assistant',
    title: 'WhatsApp assistant (your own number)',
    kind: 'concept',
    body: 'Texting your own ConvoReal number gives you a personal assistant: send listing text, an ad screenshot or a brochure PDF to add a property; forward a lead to save a contact; send "today" for your agenda; dictate events and to-dos by voice note. Drafts are confirmed with Confirm/Cancel and expire after 15 minutes. Send "help" for the full guide.',
    keywords: ['bot commands', 'voice note', 'draft', 'self chat', 'intake'],
  },
  {
    id: 'whatsapp.update-sessions',
    title: 'Updating records over WhatsApp',
    kind: 'concept',
    body: 'Texting "update property PROP-1018" or "update contact" to your ConvoReal number starts a guided field-by-field edit over WhatsApp — no need to open the app. Send "cancel" to abort or "all" for the full wizard.',
    keywords: ['edit property', 'update over whatsapp'],
  },
  {
    id: 'credits.overview',
    title: 'AI credits',
    kind: 'concept',
    body: 'AI features run on credits from your account wallet: for example an AI property description costs 10, photo enhancement 25, and a listing video 50. Paid plans receive a monthly grant and you can top up any time in Settings → Credits. The in-app helper itself is free.',
    keywords: ['wallet', 'top up', 'ai cost', 'balance'],
  },
  {
    id: 'billing.overview',
    title: 'Plans and billing',
    kind: 'concept',
    body: 'Your subscription plan, invoices and renewal live in Settings → Billing. Plans differ in team size, features and the monthly AI credit grant — the Starter plan has no AI credits. Payments go through Razorpay, with Stripe available for credit top-ups.',
    keywords: ['subscription', 'plan', 'payment', 'invoice', 'upgrade'],
  },
  {
    id: 'showcase.overview',
    title: 'Showcase portal',
    kind: 'concept',
    body: 'Your branded public listings site — buyers browse, filter, view details and send WhatsApp inquiries, no login needed. Customise the logo, colours and subdomain in Settings → Showcase. Add ?mode=agent to a link for a co-broker view that hides inquiry forms. Every listing also gets an SEO page, and projects get their own public page.',
    keywords: ['public website', 'listing site', 'branded link', 'seo'],
  },
  {
    id: 'showcase.pulse-tracking',
    title: 'Who viewed your links',
    kind: 'concept',
    body: 'Every showcase and property link you share is tracked: opens, repeat visits and time spent appear in Pulse. Buyers can tap interest (thumbs up/down) on listings, and can request gated documents, which you approve before they can view them for 48 hours.',
    keywords: ['link opens', 'interest', 'document request'],
  },
  {
    id: 'matching.engine',
    title: 'How matching works',
    kind: 'concept',
    body: 'ConvoReal scores each contact’s stored preferences (budget, localities, property type, size) against your inventory. Matches surface in Match Radar, buyer digests and share suggestions. When a customer marks a shared listing interested or rejected on WhatsApp, that feedback trains their feed — rejected properties are never offered to them again.',
    keywords: ['match score', 'preferences', 'radar', 'feedback'],
  },
  {
    id: 'leads.email-sync',
    title: 'Portal lead sync',
    kind: 'concept',
    body: 'Leads from MagicBricks, Housing.com and 99acres flow in automatically: point the portal’s lead-alert emails at your account’s lead address and each email becomes a contact with its requirement parsed, matched against inventory and tagged with its source. A Chrome extension also imports your existing portal listings.',
    keywords: [
      'magicbricks',
      'housing',
      '99acres',
      'portal leads',
      'email import',
    ],
  },
  {
    id: 'digests.overview',
    title: 'Automatic digests',
    kind: 'concept',
    body: 'ConvoReal sends scheduled WhatsApp digests: property owners get activity updates on their listing (views, inquiries), your agents get an inventory digest, and buyers get a digest of new matches. Owners and buyers receive them without installing anything.',
    keywords: ['owner update', 'daily summary', 'digest settings'],
  },
  {
    id: 'team.roles',
    title: 'Team roles',
    kind: 'concept',
    body: 'Accounts are multi-user with four roles: owner (full control and billing), admin (settings and members), agent (day-to-day work with contacts, chats and deals), viewer (read-only). Invite teammates from Settings → Members; everyone shares the same WhatsApp number and data.',
    keywords: ['invite', 'members', 'permissions', 'access'],
  },
  {
    id: 'team.routing',
    title: 'Chat routing',
    kind: 'concept',
    body: 'Routing rules in Settings assign incoming WhatsApp conversations to specific teammates automatically — by keyword, source or round-robin — so new leads always have an owner. Agents can also get a WhatsApp ping for new leads and reply to the lead by replying to the ping.',
    keywords: ['assign chats', 'auto assign', 'lead ping'],
  },
  {
    id: 'portfolio.owner',
    title: 'Portfolio for owners',
    kind: 'concept',
    body: 'Portfolio is the separate portal where property owners log in with their WhatsApp-verified phone to follow their own listings: activity, bids and deal-mode matching with secure deal rooms. Owners see only properties linked to them — never your CRM data.',
    keywords: ['owners den', 'owner login', 'bids', 'deal room'],
  },
  {
    id: 'portfolio.buyer',
    title: 'Portfolio for buyers',
    kind: 'concept',
    body: 'Buyers get their own Portfolio login too: they set preferences, browse their matches and keep a shortlist. It uses the same WhatsApp phone verification as the owner side and feeds the same matching engine your Radar uses.',
    keywords: ['buyer portal', 'buyer login', 'shortlist'],
  },
  {
    id: 'contacts.lifecycle',
    title: 'Dead and archived leads',
    kind: 'concept',
    body: 'When a lead ends their enquiry (or an agent marks them dead), every automated send stops — broadcasts, digests, matching and shares all skip them. An agent can revive a dead lead later. Archiving hides a contact from day-to-day lists without deleting history.',
    keywords: ['close enquiry', 'dead lead', 'archive contact', 'unsubscribe'],
  },
  {
    id: 'contacts.reengagement',
    title: 'Re-engaging old leads',
    kind: 'concept',
    body: 'Imported portal leads can be re-engaged with a template anchored to what they originally enquired about — the property, or the portal’s own wording of their requirement — so the message reads personal rather than bulk.',
    keywords: ['old leads', 'revive', 'win back', 'reengage'],
  },
  {
    id: 'media.ai-tools',
    title: 'AI listing media',
    kind: 'concept',
    body: 'Each property can get an AI-written description, AI photo enhancement for dull images, and an auto-generated listing video with narration, built from the property’s photos and details. Videos can be published to your connected YouTube channel. All three run on AI credits.',
    keywords: [
      'description generator',
      'photo enhance',
      'video banao',
      'youtube',
    ],
  },
  {
    id: 'mobile.app',
    title: 'Mobile app',
    kind: 'concept',
    body: 'ConvoReal has a companion mobile app with inventory, contacts, inbox, deals, calendar and property sharing, signed in with a WhatsApp OTP. Documents can be attached there too, including a photo of a paper one. App-only: phone-book contact import, home-screen widgets and a fingerprint lock. Web property links open in the app when installed.',
    keywords: ['android', 'ios', 'phone app', 'download app'],
  },
  {
    id: 'mobile.map-near-me',
    title: 'Property map and Near me',
    kind: 'concept',
    body: 'Listings show as price pins on a map on both surfaces: on web Inventory use the map toggle beside the listing tabs, in the mobile app tap the map icon on Properties. "Near me" filters by GPS distance on both — the web asks the browser for your location. Only listings with a saved location appear as pins.',
    keywords: [
      'map',
      'near me',
      'nearby',
      'gps',
      'pins',
      'aas paas',
      'location search',
    ],
  },
  {
    id: 'inventory.projects',
    title: 'Projects and units',
    kind: 'concept',
    body: 'A building or layout with many units can be grouped as a project: shared details like the map pin, amenities, brochure and possession date live on the project, each unit stays its own listing, and the project shows totals like "12 units, 3 sold, from ₹8,200/sqft" with a public project page.',
    keywords: ['tower', 'apartment complex', 'layout', 'multiple units'],
  },
  {
    id: 'documents.gated',
    title: 'Gated documents',
    kind: 'concept',
    body: 'Property documents can be shared through secure links instead of files: the buyer requests access, you approve, and the link works for 48 hours. You always see who requested and viewed what. Attach documents from either surface — open the property and use the Documents section — but approving a buyer\u2019s request is done on the web dashboard.',
    keywords: [
      'document sharing',
      'secure link',
      'approval',
      'upload document',
      'attach pdf',
      'khata',
      'sale deed',
    ],
  },

  // ---- howtos (tasks without a guided tour) -------------------
  {
    id: 'howto.share-property',
    route: '/inventory',
    title: 'Sharing properties',
    kind: 'howto',
    body: 'Open a property and use Share to send it on WhatsApp — buyers get an interactive card with "Show More Properties" and "Browse All". Share your whole showcase from the Share Showcase Portal button on Inventory. For fellow brokers, share an agent-mode link that hides buyer inquiry forms.',
    keywords: ['send property', 'whatsapp share', 'property bhejo'],
  },
  {
    id: 'howto.import-contacts',
    route: '/contacts',
    title: 'Importing contacts',
    kind: 'howto',
    body: 'Import a CSV at Contacts → Import — map your columns to fields, and duplicates are matched by phone. On the mobile app you can also import straight from your phone’s contact book. Contacts also arrive automatically from WhatsApp chats, portal lead emails and forwarded lead messages.',
    keywords: ['csv', 'bulk upload', 'excel import'],
  },
  {
    id: 'howto.listing-video',
    route: '/inventory',
    title: 'Making a listing video',
    kind: 'howto',
    body: 'Open a property and use the Listing Video card: ConvoReal builds a narrated video from the photos and details (50 credits). Once your YouTube channel is connected in Settings, publish the video to it in one step.',
    keywords: ['property video', 'reel', 'video generate'],
  },
  {
    id: 'howto.enhance-photos',
    route: '/inventory',
    title: 'Enhancing photos',
    kind: 'howto',
    body: 'On a property’s images, use AI enhancement to brighten and clean up dull photos (25 credits per image). The original is kept, so you can compare and revert.',
    keywords: ['photo improve', 'brighten image', 'photo quality'],
  },
  {
    id: 'howto.post-to-portals',
    route: '/inventory',
    title: 'Posting to property portals',
    kind: 'howto',
    body: 'Each property has a portal post kit — ready-made title, description and details formatted for MagicBricks, Housing.com and 99acres. Install the ConvoReal Chrome extension to autofill the portal’s posting form from the kit instead of retyping.',
    keywords: ['magicbricks post', 'portal listing', 'autofill'],
  },
  {
    id: 'howto.appointment-reminders',
    route: '/calendar',
    title: 'Appointment reminders',
    kind: 'howto',
    body: 'Appointments linked to a contact send automatic WhatsApp reminders — the morning of the visit and an hour before — using reminder templates every account gets by default. Customers can confirm or request a reschedule from quick-reply buttons.',
    keywords: ['reminder message', 'site visit reminder', 'reschedule'],
  },
  {
    id: 'howto.deals',
    route: '/pipelines',
    title: 'Tracking a deal',
    kind: 'howto',
    body: 'Create a deal from a contact or property, give it a value, and drag it across pipeline stages as it progresses. Closed deals record the brokerage, and deal totals feed the Dashboard numbers.',
    keywords: ['new deal', 'close deal', 'brokerage'],
  },
  {
    id: 'howto.topup-credits',
    route: '/settings',
    title: 'Buying credits',
    kind: 'howto',
    body: 'Go to Settings → Credits to see your balance, usage history and top-up packs. Payment is by Razorpay or card, and credits land instantly. The credit meter in the sidebar always shows what’s left.',
    keywords: ['recharge', 'buy credits', 'add balance'],
  },
  {
    id: 'howto.ai-description',
    route: '/inventory',
    title: 'AI property descriptions',
    kind: 'howto',
    body: 'On a property’s edit form, use Generate Description and ConvoReal writes listing copy from the fields you’ve filled — highlights, locality and specs included (10 credits). Edit the result before saving; nothing is published without you.',
    keywords: ['write description', 'listing copy', 'auto describe'],
  },
  {
    id: 'howto.buyer-feedback',
    route: '/radar',
    title: 'Buyer feedback on listings',
    kind: 'howto',
    body: 'When you share a property, the customer can reply interested or not interested (with a one-tap reason like budget or location) right in WhatsApp. The verdict shows on the contact and tunes their future matches.',
    keywords: ['interested', 'rejected', 'not interested reason'],
  },
  {
    id: 'howto.themes',
    route: '/settings',
    title: 'Changing the look',
    kind: 'howto',
    body: 'Switch between light and dark mode from the sun/moon toggle in the header. Settings → Appearance offers six accent colours for your workspace. Your showcase’s public branding is separate, under Settings → Showcase.',
    keywords: ['dark mode', 'light mode', 'accent colour', 'theme change'],
  },

  // ---- limits (what ConvoReal cannot do) -----------------------
  {
    id: 'limit.free-form-after-window',
    title: 'No free-form messages after 24 hours',
    kind: 'limit',
    body: 'ConvoReal cannot send a free-form WhatsApp message once the 24-hour window has closed — that is a WhatsApp rule, not a plan limit. Send an approved template instead, or wait for the customer to write back, which reopens the window.',
    keywords: ['window expired', 'cannot reply', 'message blocked'],
  },
  {
    id: 'limit.edit-sent-message',
    title: 'No editing or unsending messages',
    kind: 'limit',
    body: 'A delivered WhatsApp message cannot be edited or unsent from ConvoReal — the WhatsApp Business API does not allow it. Send a correction as a follow-up message instead.',
    keywords: ['delete message', 'recall', 'undo send'],
  },
  {
    id: 'limit.template-category',
    title: 'Template category cannot be changed',
    kind: 'limit',
    body: 'Once Meta approves a template, its UTILITY or MARKETING category is permanent — resubmitting the same wording under a new name will not change it, and a deleted template’s name is reserved for four weeks. If you believe the category is wrong, appeal through Meta Business Support in WhatsApp Manager within 60 days.',
    keywords: ['marketing category', 'utility category', 'recategorise'],
  },
  {
    id: 'limit.no-sms-email-campaigns',
    title: 'No SMS or email campaigns',
    kind: 'limit',
    body: 'ConvoReal sends campaigns on WhatsApp only — there is no SMS channel and no bulk email. Email is used for receiving portal leads and for account notices. For mass outreach, use Broadcasts with an approved WhatsApp template.',
    keywords: ['text message', 'email blast', 'newsletter', 'sms bhejo'],
  },
  {
    id: 'limit.no-auto-portal-post',
    title: 'No automatic portal publishing',
    kind: 'limit',
    body: 'ConvoReal cannot publish your listing to MagicBricks, Housing.com or 99acres for you — the portals do not allow it. The portal post kit plus the Chrome extension get you closest: they format the listing and autofill the portal’s form, and you press Post.',
    keywords: ['auto post', 'publish to portal', 'syndication'],
  },
  {
    id: 'limit.no-calls',
    title: 'No calling from the app',
    kind: 'limit',
    body: 'ConvoReal cannot place or record phone calls. What it can do: log calls on a contact’s timeline, and analyse an uploaded call recording with AI to pull out action items and events.',
    keywords: ['dial', 'phone call', 'call recording', 'telephony'],
  },
  {
    id: 'limit.group-messages',
    title: 'Group message limits',
    kind: 'limit',
    body: 'WhatsApp group messages cannot carry buttons, lists or interactive flows — plain text and media only, a WhatsApp rule. Groups hold up to 8 participants and members join by invite link only; ConvoReal cannot add someone directly. For interactive messages at scale, use Broadcasts.',
    keywords: ['group buttons', 'add member', 'group size'],
  },
  {
    id: 'limit.whatsapp-personal-number',
    title: 'Business API number, not your personal app',
    kind: 'limit',
    body: 'ConvoReal works through the official WhatsApp Business API, so it cannot read chats from your personal WhatsApp or WhatsApp Business app history. Conversations exist in ConvoReal from the moment your API number starts receiving them.',
    keywords: [
      'chat history',
      'personal whatsapp',
      'import chats',
      'sync old messages',
    ],
  },

  // ---- Portfolio: owners ---------------------------------------
  {
    id: 'owner.overview',
    route: '/den',
    title: 'Your Portfolio',
    kind: 'page',
    audience: 'owner',
    body: 'Your home screen as a property owner. It shows activity on the properties you own — views, enquiries, shortlists and site visits over the last 7 or 30 days — with a card per property. Your agent manages the listings; this is your window into how they are doing.',
    keywords: ['home', 'dashboard', 'activity', 'my portfolio'],
  },
  {
    id: 'owner.properties',
    route: '/den/properties',
    title: 'My Properties',
    kind: 'page',
    audience: 'owner',
    body: 'Every property linked to you, with its own view, enquiry and shortlist counts. Open one to see its full activity and whether Deal Mode is on. Properties appear here when the agency handling them links your phone number to the listing.',
    keywords: ['my listings', 'flats', 'plots', 'property list'],
  },
  {
    id: 'owner.bids',
    route: '/den/bids',
    title: 'Offers',
    kind: 'page',
    audience: 'owner',
    body: 'Offers buyers have made on your Deal Mode properties. Bidders stay anonymous until you accept — you see the amount and terms, not who they are. Accepting reveals their contact details to you and yours to them, with a WhatsApp shortcut to carry on the conversation.',
    keywords: ['bids', 'offers', 'price offer', 'negotiate'],
  },
  {
    id: 'owner.settings',
    route: '/den/settings',
    title: 'Portfolio settings',
    kind: 'page',
    audience: 'owner',
    body: 'Your name, your verified WhatsApp number, and what you want to hear about — new match alerts, new offers, and how often you get an activity digest (off, daily or weekly). Turning a notification off never hides anything inside the portal.',
    keywords: ['notifications', 'digest', 'alerts', 'profile'],
  },
  {
    id: 'owner.deal-mode',
    title: 'Deal Mode',
    kind: 'concept',
    audience: 'owner',
    body: 'Deal Mode puts a property in front of buyers and agents outside your own agency. They see only the locality, a price band and basic details — never your name, the address or the photos — and pay to unlock the rest. Your agent turns Deal Mode on for a property; you see the offers it brings in under Offers.',
    keywords: ['open market', 'wider reach', 'anonymous listing'],
  },
  {
    id: 'owner.deal-rooms',
    title: 'Deal rooms and token payments',
    kind: 'concept',
    audience: 'owner',
    body: 'Accepting an offer opens a private deal room with that buyer for the paperwork stage. A token amount can be recorded there and is only released when both sides confirm the agreement to sell is signed; either side can cancel before that. Every step is logged so there is no dispute about what was agreed.',
    keywords: ['token', 'escrow', 'advance', 'agreement to sell'],
  },
  {
    id: 'owner.who-sees-what',
    title: 'Who can see your details',
    kind: 'concept',
    audience: 'owner',
    body: 'Only the agency you work with sees your name and number. Buyers browsing a Deal Mode property see a masked version — locality and price band — and your identity is revealed only after you accept their offer. You see the same activity numbers your agent does for your own properties, and nothing about anyone else’s.',
    keywords: ['privacy', 'anonymous', 'my details', 'contact hidden'],
  },
  {
    id: 'owner.adding-property',
    title: 'Adding a property',
    kind: 'howto',
    audience: 'owner',
    body: 'You can submit a property from the portal and it goes to your agency for review before it appears anywhere public. They fill in the details buyers expect, add photos and publish it. Anything you submit stays linked to you, so its activity shows up in your Portfolio.',
    keywords: ['new property', 'add listing', 'submit property'],
  },
  {
    id: 'owner.limit-edit',
    title: 'Your agent edits the listing',
    kind: 'limit',
    audience: 'owner',
    body: 'You cannot change a listing’s price, description or photos from the Portfolio — the agency that markets it owns those details, so that what buyers see stays accurate. Ask your agent and they can update it in minutes; the change shows here straight away.',
    keywords: ['change price', 'edit listing', 'update photos'],
  },
  {
    id: 'owner.limit-buyer-contact',
    title: 'Buyer identities before you accept',
    kind: 'limit',
    audience: 'owner',
    body: 'The Portfolio cannot show you who made an offer before you accept it — anonymity is what makes bidders comfortable making one. You always see the amount and the terms first, and accepting reveals both sides at once.',
    keywords: ['who is the buyer', 'bidder name', 'unmask'],
  },
  {
    id: 'owner.limit-other-listings',
    title: 'Only your own properties',
    kind: 'limit',
    audience: 'owner',
    body: 'The Portfolio shows the properties linked to you and nothing else — it is not a place to browse the market or see other owners’ listings. Ask your agent for the agency’s public listing link if you want to look around.',
    keywords: ['browse listings', 'other properties', 'search market'],
  },

  // ---- Portfolio: buyers ---------------------------------------
  {
    id: 'buyer.overview',
    route: '/buyer',
    title: 'Your shortlist',
    kind: 'page',
    audience: 'buyer',
    body: 'Your home screen as a buyer: the properties you have saved. Anything you told an agent you liked, or tapped interested on, is already here. Open a property for the full details and to message the agent handling it.',
    keywords: ['saved', 'favourites', 'my list', 'home'],
  },
  {
    id: 'buyer.matches',
    route: '/buyer/matches',
    title: 'Matches',
    kind: 'page',
    audience: 'buyer',
    body: 'Properties matched to what you are looking for. Listings from agencies you already deal with show full details; wider-market ones show locality and a price band until the owner’s side reveals more. Save anything you like to your shortlist.',
    keywords: ['suggestions', 'recommended', 'new properties'],
  },
  {
    id: 'buyer.preferences',
    route: '/buyer/preferences',
    title: 'Preferences',
    kind: 'page',
    audience: 'buyer',
    body: 'Your brief: budget, the localities you want, property type and size. Matches are built from this, so keeping it current is the fastest way to get better suggestions. Your agent sees the same brief and can act on it.',
    keywords: ['budget', 'locality', 'requirement', 'what i want'],
  },
  {
    id: 'buyer.settings',
    route: '/buyer/settings',
    title: 'Buyer settings',
    kind: 'page',
    audience: 'buyer',
    body: 'Your name, your verified WhatsApp number, and whether you want alerts when new properties match your brief. Turning alerts off stops the WhatsApp messages; your matches still update inside the portal.',
    keywords: ['notifications', 'alerts', 'profile', 'stop messages'],
  },
  {
    id: 'buyer.how-matching-works',
    title: 'How matches are chosen',
    kind: 'concept',
    audience: 'buyer',
    body: 'Your preferences are scored against properties the agencies you deal with have listed, plus wider-market listings opened up by their owners. Marking something not interested — and saying why, like budget or location — stops similar properties coming back, so the feed sharpens as you use it.',
    keywords: ['why this property', 'algorithm', 'not interested'],
  },
  {
    id: 'buyer.privacy',
    title: 'What agents can see',
    kind: 'concept',
    audience: 'buyer',
    body: 'The agencies you have contacted see your brief, your shortlist and your enquiries, because they are the ones finding you properties. On wider-market listings you stay anonymous to the owner until an offer is accepted. Other buyers never see anything about you.',
    keywords: ['privacy', 'my data', 'who sees', 'anonymous'],
  },
  {
    id: 'buyer.limit-book-visit',
    title: 'Arranging a site visit',
    kind: 'limit',
    audience: 'buyer',
    body: 'The portal cannot book a site visit by itself — the agent handling the property confirms the slot. Message them from the property and they will schedule it, and you will get a WhatsApp reminder before the visit.',
    keywords: ['site visit', 'book viewing', 'appointment'],
  },
  {
    id: 'buyer.limit-owner-contact',
    title: 'Contacting the owner directly',
    kind: 'limit',
    audience: 'buyer',
    body: 'You cannot get the owner’s number from the portal; enquiries go through the agent handling the property. On wider-market listings the owner is revealed only when an offer is accepted. Your agent can answer most questions faster anyway.',
    keywords: ['owner number', 'direct contact', 'skip agent'],
  },
  {
    id: 'buyer.limit-price-negotiate',
    title: 'Negotiating in the portal',
    kind: 'limit',
    audience: 'buyer',
    body: 'There is no haggling screen here — price conversations happen with the agent, on WhatsApp. Tell them your number and they will carry it to the owner and come back to you.',
    keywords: ['bargain', 'lower price', 'make an offer', 'discount'],
  },
];

const registry = new Map(CHUNKS.map((c) => [c.id, c]));

export function getChunk(id: string): KnowledgeChunk | undefined {
  return registry.get(id);
}

/**
 * Content hash of one chunk (FNV-1a, hex). Cached answers record the
 * versions of the chunks they were built from; editing a chunk
 * retires exactly those answers. Pure JS on purpose — this must stay
 * importable outside node (no node:crypto).
 */
export function chunkVersion(chunk: KnowledgeChunk): string {
  const text = [
    chunk.id,
    chunk.route ?? '',
    chunk.title,
    chunk.body,
    (chunk.keywords ?? []).join(','),
    chunk.kind,
  ].join(' ');
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function isCurrentChunk(id: string, version: string): boolean {
  const chunk = registry.get(id);
  return !!chunk && chunkVersion(chunk) === version;
}
