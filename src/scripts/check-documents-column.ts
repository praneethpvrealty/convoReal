import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing SUPABASE environment variables.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function main() {
  console.log("Checking properties table...");
  const { data, error } = await supabase.from('properties').select('id, documents').limit(1);
  if (error) {
    console.error("Error fetching properties table (specifically documents column):", error);
  } else {
    console.log("Success! Documents column is available.", data);
  }
}

main();
