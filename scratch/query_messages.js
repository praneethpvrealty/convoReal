const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function test() {
  // Let's find the last message with the error text
  const { data: msgs, error } = await supabase
    .from('messages')
    .select('*')
    .ilike('content_text', '%Error saving property%')
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) {
    console.error('Failed to query messages:', error);
    return;
  }

  console.log('Last Error Messages found:', msgs.length);
  for (const msg of msgs) {
    console.log(`\n--- Message ID: ${msg.id} | Created: ${msg.created_at} ---`);
    console.log(`Body: ${msg.content_text}`);
    console.log(`Conversation ID: ${msg.conversation_id}`);
    
    // Fetch context of this conversation
    const { data: convMsgs } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', msg.conversation_id)
      .order('created_at', { ascending: true });
      
    console.log('Conversation History (last 10):');
    convMsgs.slice(-10).forEach(m => {
      console.log(`[${m.sender_type}] ${m.content_text ? m.content_text.substring(0, 100) : ''}`);
    });
  }
}

test();
