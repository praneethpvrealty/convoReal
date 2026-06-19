const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://cvmgojajtegbuuujtptn.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2bWdvamFqdGVnYnV1dWp0cHRuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDAzMzUyNiwiZXhwIjoyMDk1NjA5NTI2fQ.NUuWkZa49alEziMFGZA8KgDrHqb_89wPjeMm1dvGeB4';

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  try {
    console.log("🔍 Querying last 10 messages...");
    const { data: messages, error } = await supabase
      .from('messages')
      .select('*, conversation:conversations(contact:contacts(name, phone))')
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) {
      console.error("❌ Error:", error);
      return;
    }

    console.log(`📋 Recent Messages (Total: ${messages.length}):`);
    messages.forEach((msg, idx) => {
      console.log(`\n[${idx + 1}] Sent At: ${msg.created_at}`);
      console.log(`    Contact: ${msg.conversation?.contact?.name || 'Unknown'} (${msg.conversation?.contact?.phone || 'N/A'})`);
      console.log(`    Sender: ${msg.sender_type} | Content Type: ${msg.content_type} | Status: ${msg.status}`);
      console.log(`    Content: "${msg.content_text}"`);
    });
  } catch (err) {
    console.error("Execution error:", err);
  }
}

run();
