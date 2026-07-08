const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function main() {
  const { data, error } = await supabase.from('property_document_requests').select('access_password').limit(1);
  if (error) {
    console.log("Column 'access_password' does not exist or error:", error.message);
  } else {
    console.log("Column 'access_password' exists!");
  }
}

main();
