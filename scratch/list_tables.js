const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://cvmgojajtegbuuujtptn.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2bWdvamFqdGVnYnV1dWp0cHRuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDAzMzUyNiwiZXhwIjoyMDk1NjA5NTI2fQ.NUuWkZa49alEziMFGZA8KgDrHqb_89wPjeMm1dvGeB4';

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  try {
    const { data, error } = await supabase.rpc('execute_sql', {
      sql_query: "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;"
    });

    if (error) {
      // If RPC execute_sql doesn't exist, try querying a system table or using postgres functions if enabled
      console.log("RPC Error:", error.message);
      
      // Let's try to query some standard tables directly to verify if they exist
      const checkTables = [
        'properties', 'contacts', 'messages', 'conversations', 
        'property_shares', 'property_interactions', 'interested_contacts',
        'broadcasts', 'broadcast_recipients', 'deals'
      ];
      
      for (const t of checkTables) {
        const { data: testData, error: testErr } = await supabase.from(t).select('*').limit(1);
        if (testErr) {
          console.log(`❌ Table '${t}' does not exist or error:`, testErr.message);
        } else {
          console.log(`✅ Table '${t}' EXISTS!`);
        }
      }
    } else {
      console.log("Tables:", data);
    }
  } catch (err) {
    console.error("Error:", err);
  }
}

run();
