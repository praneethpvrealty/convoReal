/* eslint-disable @typescript-eslint/no-require-imports */
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing SUPABASE environment variables.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function main() {
  console.log("Checking properties table columns...");
  const { data, error } = await supabase.from('properties').select('id, documents').limit(1);
  if (error) {
    console.error("Error fetching documents column:", error.message);
  } else {
    console.log("Success! Documents column is available. Data preview:", data);
  }
}

main();
