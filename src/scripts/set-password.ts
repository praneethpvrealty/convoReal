import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const email = 'praneethpvrealty@gmail.com';
  const { data: { users }, error: listErr } = await supabase.auth.admin.listUsers();
  if (listErr) {
    console.error('List error:', listErr);
    return;
  }
  const user = users.find(u => u.email === email);
  if (!user) {
    console.error('User not found:', email);
    return;
  }
  const { data, error } = await supabase.auth.admin.updateUserById(
    user.id,
    { password: 'password123', email_confirm: true }
  );
  if (error) {
    console.error('Error updating password:', error);
  } else {
    console.log('Successfully set password for', email, 'to: password123');
  }
}

main();
