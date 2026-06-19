const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://cvmgojajtegbuuujtptn.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2bWdvamFqdGVnYnV1dWp0cHRuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDAzMzUyNiwiZXhwIjoyMDk1NjA5NTI2fQ.NUuWkZa49alEziMFGZA8KgDrHqb_89wPjeMm1dvGeB4';

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log("🔍 Fetching message templates...");
  const { data: templates, error: err } = await supabase
    .from('message_templates')
    .select('*');
  
  if (err) {
    console.error("❌ Error fetching templates:", err);
  } else {
    console.log("Found templates:");
    templates.forEach(t => {
      console.log(`- ID: ${t.id}, Name: ${t.name}, Language: ${t.language}, Status: ${t.status}`);
    });
  }
}

main().catch(console.error);
