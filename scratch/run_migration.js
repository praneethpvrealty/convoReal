const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing env variables.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function main() {
  console.log("Running migration via execute_sql RPC...");
  const sql = "ALTER TABLE property_document_requests ADD COLUMN IF NOT EXISTS access_password TEXT;";
  const { data, error } = await supabase.rpc('execute_sql', { sql_query: sql });
  if (error) {
    console.error("Migration failed:", error.message);
  } else {
    console.log("Migration succeeded! Result:", data);
  }
}

main();
