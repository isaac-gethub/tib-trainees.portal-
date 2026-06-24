// ═══════════════════════════════════════════════════════════════════════════
// TIB Systems Inc. — TIB-LMS-SUB-001-MASTER
// Webhook 3: Subscription Ended / Cancelled
// Deploy to: /api/webhook-subscription-end.js in your Vercel project
// ═══════════════════════════════════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async (req, res) => {

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const incomingSecret = req.headers['x-systeme-secret'];
  if (!incomingSecret || incomingSecret !== process.env.SYSTEME_WEBHOOK_SECRET) {
    console.warn('[TIB-WEBHOOK] Unauthorised request — secret mismatch');
    return res.status(401).json({ error: 'Unauthorised' });
  }

  const email          = req.body?.contact?.email;
  const subscriptionId = req.body?.subscription?.id;
  const reason         = req.body?.subscription?.cancellation_reason || 'plan_complete';

  if (!email) {
    console.error('[TIB-WEBHOOK] Missing contact.email in payload:', JSON.stringify(req.body));
    return res.status(400).json({ error: 'Missing email in payload' });
  }

  console.log(`[TIB-WEBHOOK] Subscription ENDED — ${email} | sub: ${subscriptionId} | reason: ${reason}`);

  // ── Look up user_id from auth.users ───────────────────────────────────────
  const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
  if (listError) {
    console.error('[TIB-WEBHOOK] Auth lookup error:', listError.message);
    return res.status(500).json({ error: listError.message });
  }

  const authUser = users.find(u => u.email === email);
  if (!authUser) {
    return res.status(404).json({ error: `No user found for email: ${email}` });
  }

  const userId = authUser.id;

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
