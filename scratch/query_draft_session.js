const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function test() {
  const { data: contact } = await supabase
    .from('contacts')
    .select('id, name, phone')
    .eq('phone', '+918197845218')
    .maybeSingle();

  if (!contact) {
    console.log('Contact not found');
    return;
  }
  console.log('Contact found:', contact);

  const { data: session, error } = await supabase
    .from('property_draft_sessions')
    .select('*')
    .eq('contact_id', contact.id)
    .maybeSingle();

  if (error) {
    console.error('Failed to query session:', error);
    return;
  }

  if (!session) {
    console.log('No active property draft session found for this contact');
    return;
  }

  console.log('Draft Session found:', session);
  console.log('Draft data:', JSON.stringify(session.draft_data, null, 2));
}

test();
