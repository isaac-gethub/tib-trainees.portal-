// ═══════════════════════════════════════════════════════════════════════════
// TIB Systems Inc. — TIB-LMS-SUB-001-MASTER
// Webhook 1: Payment Successful
// Fires on EVERY successful monthly charge (Months 1–6)
// Deploy to: /api/webhook-payment-success.js in your Vercel project
// ═══════════════════════════════════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');

// MUST use service key — anon key cannot bypass RLS for server writes
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
  const email      = req.body?.contact?.email;
  const paymentRef = req.body?.subscription?.id || req.body?.order?.id;
  const amount     = req.body?.order?.amount || 'unknown';

  if (!email) {
    console.error('[TIB-WEBHOOK] Missing contact.email in payload:', JSON.stringify(req.body));
    return res.status(400).json({ error: 'Missing email in payload' });
  }

  console.log(`[TIB-WEBHOOK] Payment success — ${email} | ref: ${paymentRef} | amount: ${amount}`);

  // ── Rolling 30-day expiry — extended on every successful monthly payment ──
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + 30);

  // ── Write to Supabase ─────────────────────────────────────────────────────
  const { error } = await supabase
    .from('user_profiles')
    .update({
      subscription_active:  true,
      subscription_expiry:  expiry.toISOString(),
      failed_payment_count: 0,          // reset counter on success
      payment_ref:          paymentRef
    })
    .eq('email', email);

  if (error) {
    console.error('[TIB-WEBHOOK] Supabase write error:', error.message);
    return res.status(500).json({ error: error.message });
  }

  console.log(`[TIB-WEBHOOK] Supabase updated — access active until ${expiry.toISOString()}`);
  return res.status(200).json({
    success: true,
    email,
    subscription_active: true,
    subscription_expiry: expiry.toISOString()
  });
};
