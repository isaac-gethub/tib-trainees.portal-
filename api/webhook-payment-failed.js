const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const email          = req.body?.customer?.email;
  const subscriptionId = req.body?.order?.id;

  if (!email) {
    console.error('[TIB-WEBHOOK] Missing email in payload:', JSON.stringify(req.body));
    return res.status(400).json({ error: 'Missing email in payload' });
  }

  console.warn(`[TIB-WEBHOOK] Payment FAILED — ${email} | ref: ${subscriptionId}`);

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

  // Find user
  const listRes  = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`, {
    headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` }
  });
  const listData = await listRes.json();

  if (!listData.users || listData.users.length === 0) {
    console.error('[TIB-WEBHOOK] No user found for email:', email);
    return res.status(404).json({ error: `No user found for email: ${email}` });
  }

  const userId = listData.users[0].id;

  // Fetch current failure count
  const { data: profile, error: fetchError } = await supabase
    .from('user_profiles')
    .select('failed_payment_count')
    .eq('user_id', userId)
    .maybeSingle();

  if (fetchError) {
    console.error('[TIB-WEBHOOK] Supabase fetch error:', fetchError.message);
    return res.status(500).json({ error: fetchError.message });
  }

  const newCount = (profile?.failed_payment_count || 0) + 1;

  const { error: updateError } = await supabase
    .from('user_profiles')
    .update({ failed_payment_count: newCount })
    .eq('user_id', userId);

  if (updateError) {
    console.error('[TIB-WEBHOOK] Supabase update error:', updateError.message);
    return res.status(500).json({ error: updateError.message });
  }

  console.warn(`[TIB-WEBHOOK] ${email} — failed payment #${newCount}. Access MAINTAINED.`);

  return res.status(200).json({
    success: true,
    email,
    failed_payment_count: newCount,
    access_revoked: false,
    note: 'Systeme.io will retry automatically. Access revoked only on subscription cancellation.'
  });
};
