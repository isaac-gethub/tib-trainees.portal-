// ═══════════════════════════════════════════════════════════════════════════
// TIB Systems Inc. — TIB-LMS-SUB-001-MASTER
// Webhook 2: Payment Failed
// Fires when a monthly charge is declined
// Deploy to: /api/webhook-payment-failed.js in your Vercel project
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
  const subscriptionId = req.body?.subscription?.id || req.body?.order?.id;

  if (!email) {
    console.error('[TIB-WEBHOOK] Missing contact.email in payload:', JSON.stringify(req.body));
    return res.status(400).json({ error: 'Missing email in payload' });
  }

  console.warn(`[TIB-WEBHOOK] Payment FAILED — ${email} | sub: ${subscriptionId}`);

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

  // ── Fetch current failure count ───────────────────────────────────────────
  const { data: profile, error: fetchError } = await supabase
    .from('user_profiles')
    .select('failed_payment_count')
    .eq('user_id', userId)
    .single();

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
