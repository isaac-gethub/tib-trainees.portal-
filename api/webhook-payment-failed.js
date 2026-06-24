// ═══════════════════════════════════════════════════════════════════════════
// TIB Systems Inc. — TIB-LMS-SUB-001-MASTER
// Webhook 2: Payment Failed
// Fires when a monthly charge is declined
// Deploy to: /api/webhook-payment-failed.js in your Vercel project
//
// IMPORTANT: Do NOT revoke access here.
// Systeme.io retries 3× over 5 days automatically.
// Access is only revoked when Webhook 3 fires (subscription cancelled).
// ═══════════════════════════════════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async (req, res) => {

  // ── Method guard ──────────────────────────────────────────────────────────
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Security: validate Systeme.io secret header ───────────────────────────
  const incomingSecret = req.headers['x-systeme-secret'];
  if (!incomingSecret || incomingSecret !== process.env.SYSTEME_WEBHOOK_SECRET) {
    console.warn('[TIB-WEBHOOK] Unauthorised request — secret mismatch');
    return res.status(401).json({ error: 'Unauthorised' });
  }

  // ── Extract payload ───────────────────────────────────────────────────────
  const email         = req.body?.contact?.email;
  const subscriptionId = req.body?.subscription?.id || req.body?.order?.id;

  if (!email) {
    console.error('[TIB-WEBHOOK] Missing contact.email in payload:', JSON.stringify(req.body));
    return res.status(400).json({ error: 'Missing email in payload' });
  }

  console.warn(`[TIB-WEBHOOK] Payment FAILED — ${email} | sub: ${subscriptionId}`);

  // ── Fetch current failure count ───────────────────────────────────────────
  const { data: user, error: fetchError } = await supabase
    .from('user_profiles')
    .select('failed_payment_count')
    .eq('email', email)
    .single();

  if (fetchError) {
    console.error('[TIB-WEBHOOK] Supabase fetch error:', fetchError.message);
    return res.status(500).json({ error: fetchError.message });
  }

  const newCount = (user?.failed_payment_count || 0) + 1;

  // ── Increment failure counter — access NOT revoked ────────────────────────
  const { error: updateError } = await supabase
    .from('user_profiles')
    .update({ failed_payment_count: newCount })
    .eq('email', email);

  if (updateError) {
    console.error('[TIB-WEBHOOK] Supabase update error:', updateError.message);
    return res.status(500).json({ error: updateError.message });
  }

  // ── Log for manual review dashboard ──────────────────────────────────────
  console.warn(`[TIB-WEBHOOK] ${email} — failed payment #${newCount}. Access MAINTAINED pending Systeme.io retry.`);

  return res.status(200).json({
    success: true,
    email,
    failed_payment_count: newCount,
    access_revoked: false,
    note: 'Systeme.io will retry automatically. Access revoked only on subscription cancellation (Webhook 3).'
  });
};
