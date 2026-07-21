/* eslint-disable */
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load env variables manually from .env.local
const envPath = path.resolve(__dirname, '../.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (match) {
      const key = match[1];
      let value = match[2].trim();
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.substring(1, value.length - 1);
      } else if (value.startsWith("'") && value.endsWith("'")) {
        value = value.substring(1, value.length - 1);
      }
      process.env[key] = value;
    }
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  console.error("❌ NEXT_PUBLIC_SUPABASE_URL is not defined in env variables.");
  process.exit(1);
}
if (!supabaseKey) {
  console.error("❌ SUPABASE_SERVICE_ROLE_KEY is not defined in env variables.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// List of premium muted colors to use for newly created tags
const PREMIUM_COLORS = [
  '#0EA5E9', // Sky blue
  '#10B981', // Emerald green
  '#8B5CF6', // Purple
  '#F59E0B', // Amber
  '#EC4899', // Pink
  '#6366F1', // Indigo
  '#EF4444', // Rose red
  '#14B8A6'  // Teal
];

function getRandomColor() {
  return PREMIUM_COLORS[Math.floor(Math.random() * PREMIUM_COLORS.length)];
}

async function runNotesMigration() {
  console.log("🚀 Starting one-time notes-to-property matching script...");

  // 1. Fetch all published properties
  console.log("🏡 Fetching published properties...");
  const { data: properties, error: propErr } = await supabase
    .from('properties')
    .select('id, title, property_code, project, account_id')
    .eq('is_published', true);

  if (propErr) {
    console.error("❌ Error fetching properties:", propErr);
    return;
  }
  console.log(`✅ Loaded ${properties.length} published properties.`);

  // 1.5. Fetch all profiles to map account_id to user_id (required to create tags)
  console.log("👤 Fetching profiles for user_id mapping...");
  const { data: profiles, error: profileErr } = await supabase
    .from('profiles')
    .select('user_id, account_id, account_role');

  if (profileErr) {
    console.error("❌ Error fetching profiles:", profileErr);
    return;
  }

  const accountUserMap = new Map(); // key: account_id, value: user_id
  profiles.forEach(p => {
    accountUserMap.set(p.account_id, p.user_id);
  });
  // Prioritize 'owner' roles
  profiles.forEach(p => {
    if (p.account_role === 'owner') {
      accountUserMap.set(p.account_id, p.user_id);
    }
  });
  console.log(`✅ Loaded ${profiles.length} profiles for mapping.`);

  // 2. Fetch all contacts with notes
  console.log("👥 Fetching contacts with notes...");
  const { data: contacts, error: contactErr } = await supabase
    .from('contacts')
    .select(`
      id,
      name,
      account_id,
      last_inquired_property_id,
      contact_notes(id, note_text)
    `);

  if (contactErr) {
    console.error("❌ Error fetching contacts:", contactErr);
    return;
  }
  console.log(`✅ Loaded ${contacts.length} contacts.`);

  // 3. Fetch all existing tags to avoid duplicate insertions
  console.log("🏷️ Fetching existing tags...");
  const { data: existingTags, error: tagErr } = await supabase
    .from('tags')
    .select('id, name, account_id');

  if (tagErr) {
    console.error("❌ Error fetching tags:", tagErr);
    return;
  }
  
  // Cache tags for fast lookup by account_id and lowercase name
  const tagsCache = new Map(); // key: "accountId_tagName", value: tagId
  existingTags.forEach(t => {
    tagsCache.set(`${t.account_id}_${t.name.toLowerCase()}`, t.id);
  });
  console.log(`✅ Cached ${existingTags.length} existing tags.`);

  // 4. Fetch all existing contact tags link to avoid duplicate link entries
  console.log("🔗 Fetching existing contact tag links...");
  const { data: existingLinks, error: linkErr } = await supabase
    .from('contact_tags')
    .select('contact_id, tag_id');

  if (linkErr) {
    console.error("❌ Error fetching contact tag links:", linkErr);
    return;
  }

  const linksCache = new Set(); // value: "contactId_tagId"
  existingLinks.forEach(l => {
    linksCache.add(`${l.contact_id}_${l.tag_id}`);
  });
  console.log(`✅ Cached ${existingLinks.length} existing contact-tag links.`);

  let propertiesLinkedCount = 0;
  let tagsCreatedCount = 0;
  let tagsLinkedCount = 0;

  // 5. Iterate and match contacts
  for (const contact of contacts) {
    const contactNotes = contact.contact_notes || [];
    if (contactNotes.length === 0) continue;

    // Concatenate all note texts
    const notesText = contactNotes.map(n => n.note_text).join(' ').toLowerCase();
    const accountProperties = properties.filter(p => p.account_id === contact.account_id);

    if (accountProperties.length === 0) continue;

    // Search for a matching property in the same account
    const matchedProp = accountProperties.find(p => {
      // 1. Code match (e.g. PROP-1002)
      if (p.property_code && notesText.includes(p.property_code.toLowerCase())) {
        return true;
      }

      // 2. Title match
      if (notesText.includes(p.title.toLowerCase())) {
        return true;
      }

      // 3. Full project match (minimum 3 characters)
      if (p.project && p.project.trim().length >= 3) {
        const proj = p.project.trim().toLowerCase();
        if (notesText.includes(proj)) return true;
      }

      // 4. First 2 words of project match (e.g., "SJR Blue" for "SJR Blue Waters")
      if (p.project) {
        const projectWords = p.project.trim().toLowerCase().split(/\s+/);
        if (projectWords.length >= 2) {
          const firstTwoWords = projectWords.slice(0, 2).join(' ');
          if (firstTwoWords.length >= 5 && notesText.includes(firstTwoWords)) {
            return true;
          }
        }
      }

      // 5. Cleaned title keywords match (ignores prepositions and common specifiers)
      const stopWords = new Set(['in', 'at', 'to', 'on', 'of', 'a', 'an', 'the', 'with', 'by', 'for', 'and', 'or', 'is', 'are', 'am', 'was', 'were']);
      const cleanTitle = p.title
        .toLowerCase()
        .replace(/(?:\d+\s*(?:bhk|bedroom|bath|bathroom)|apartment|villa|plot|house|for\s+sale|for\s+rent|luxurious|luxury|beautiful|spacious|rent|sale)/gi, ' ')
        .replace(/[^\w\s]/g, ' ')
        .trim();
      
      const cleanWords = cleanTitle.split(/\s+/).filter(w => w.length > 1 && !stopWords.has(w));
      if (cleanWords.length >= 2) {
        const phrase2 = cleanWords.slice(0, 2).join(' ');
        if (phrase2.length >= 6 && notesText.includes(phrase2)) {
          return true;
        }
        if (cleanWords.length >= 3) {
          const phrase3 = cleanWords.slice(0, 3).join(' ');
          if (phrase3.length >= 8 && notesText.includes(phrase3)) {
            return true;
          }
        }
      }

      // 6. Fallback project keywords from title
      const projectKeywords = p.title.replace(/(?:\d+\s*(?:BHK|bhk)|apartment|villa|plot|house|for\s+sale|for\s+rent)/gi, '').trim();
      if (projectKeywords.length > 5 && notesText.includes(projectKeywords.toLowerCase())) {
        return true;
      }

      return false;
    });

    if (matchedProp) {
      console.log(`\n🔍 Contact "${contact.name}" (${contact.id}) matches property: "${matchedProp.title}"`);
      
      // A. Link property to contact if not already linked to this exact property
      if (contact.last_inquired_property_id !== matchedProp.id) {
        const { error: updateErr } = await supabase
          .from('contacts')
          .update({ last_inquired_property_id: matchedProp.id })
          .eq('id', contact.id);

        if (updateErr) {
          console.error(`   ❌ Failed to link property to contact:`, updateErr);
        } else {
          console.log(`   ✅ Linked property "${matchedProp.title}" as Inquired Property.`);
          propertiesLinkedCount++;
        }
      } else {
        console.log(`   ℹ️ Property already linked as Inquired Property.`);
      }

      // B. Determine tag name based on project name or property details
      let tagName = '';
      if (matchedProp.project && matchedProp.project.trim().length >= 3) {
        tagName = matchedProp.project.trim();
      } else if (matchedProp.property_code) {
        tagName = matchedProp.property_code.trim();
      } else {
        // Strip BHK count and extra details from title to keep tag clean
        tagName = matchedProp.title.replace(/(?:\d+\s*(?:BHK|bhk)|apartment|villa|plot|house|for\s+sale|for\s+rent)/gi, '').trim();
        if (tagName.length > 20) {
          tagName = tagName.substring(0, 20) + '...';
        }
      }

      if (tagName) {
        const cacheKey = `${contact.account_id}_${tagName.toLowerCase()}`;
        let tagId = tagsCache.get(cacheKey);

        // C. Create tag if it doesn't exist
        if (!tagId) {
          console.log(`   🏷️ Tag "${tagName}" does not exist. Creating new tag...`);
          const userIdForTag = accountUserMap.get(contact.account_id);
          if (!userIdForTag) {
            console.warn(`   ⚠️ Warning: No user_id found for account_id: ${contact.account_id}. Tag insertion might fail.`);
          }

          const { data: newTag, error: createTagErr } = await supabase
            .from('tags')
            .insert({
              account_id: contact.account_id,
              user_id: userIdForTag,
              name: tagName,
              color: getRandomColor()
            })
            .select()
            .single();

          if (createTagErr) {
            console.error(`   ❌ Failed to create tag:`, createTagErr);
            continue;
          } else {
            tagId = newTag.id;
            tagsCache.set(cacheKey, tagId);
            tagsCreatedCount++;
            console.log(`   ✅ Tag "${tagName}" created with ID: ${tagId}`);
          }
        }

        // D. Link tag to contact
        const linkKey = `${contact.id}_${tagId}`;
        if (!linksCache.has(linkKey)) {
          const { error: linkTagErr } = await supabase
            .from('contact_tags')
            .insert({
              contact_id: contact.id,
              tag_id: tagId
            });

          if (linkTagErr) {
            console.error(`   ❌ Failed to link tag to contact:`, linkTagErr);
          } else {
            linksCache.add(linkKey);
            tagsLinkedCount++;
            console.log(`   ✅ Tag "${tagName}" successfully linked to contact.`);
          }
        } else {
          console.log(`   ℹ️ Tag "${tagName}" is already linked to this contact.`);
        }
      }
    }
  }

  console.log("\n==========================================");
  console.log("🎉 Execution Completed successfully!");
  console.log(`Properties Linked to Contacts: ${propertiesLinkedCount}`);
  console.log(`New Tags Created: ${tagsCreatedCount}`);
  console.log(`Tag Links Created: ${tagsLinkedCount}`);
  console.log("==========================================");
}

runNotesMigration().catch(console.error);
