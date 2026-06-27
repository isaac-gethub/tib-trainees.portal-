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

  const email  = req.body?.customer?.email;
  const reason = req.body?.subscription?.cancellation_reason || 'plan_complete';

  if (!email) {
    console.error('[TIB-WEBHOOK] Missing email in payload:', JSON.stringify(req.body));
    return res.status(400).json({ error: 'Missing email in payload' });
  }

  console.log(`[TIB-WEBHOOK] Subscription ENDED — ${email} | reason: ${reason}`);

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

  const { error } = await supabase
    .from('user_profiles')
    .update({
      subscription_active:  false,
      active_session_token: null
    })
    .eq('user_id', userId);

  if (error) {
    console.error('[TIB-WEBHOOK] Supabase write error:', error.message);
    return res.status(500).json({ error: error.message });
  }

  console.log(`[TIB-WEBHOOK] Access REVOKED for ${email}`);

  return res.status(200).json({
    success: true,
    email,
    subscription_active: false,
    session_cleared: true,
    reason
  });
};
