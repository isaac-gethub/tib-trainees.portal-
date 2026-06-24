// ═══════════════════════════════════════════════════════════════════════════
// TIB Systems Inc. — TIB-LMS-SUB-001-MASTER
// Webhook 3: Subscription Ended / Cancelled
// Fires when:
//   (a) All 6 payments complete — natural plan end
//   (b) Subscription cancelled manually in Systeme.io
//   (c) Final payment retry exhausted — Systeme.io auto-cancels
// Deploy to: /api/webhook-subscription-end.js in your Vercel project
//
// This is the ONLY webhook that revokes access.
// It also clears the session token to force immediate logout.
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
  const email          = req.body?.contact?.email;
  const subscriptionId = req.body?.subscription?.id;
  const reason         = req.body?.subscription?.cancellation_reason || 'plan_complete';

  if (!email) {
    console.error('[TIB-WEBHOOK] Missing contact.email in payload:', JSON.stringify(req.body));
    return res.status(400).json({ error: 'Missing email in payload' });
  }

  console.log(`[TIB-WEBHOOK] Subscription ENDED — ${email} | sub: ${subscriptionId} | reason: ${reason}`);

  // ── Revoke access AND clear session token ─────────────────────────────────
  // Clearing active_session_token means on the student's NEXT page load,
  // tibSessionGuard() will detect a token mismatch and redirect to login.
  const { error } = await supabase
    .from('user_profiles')
    .update({
      subscription_active:  false,
      active_session_token: null    // forces immediate logout on next page load
    })
    .eq('email', email);

  if (error) {
    console.error('[TIB-WEBHOOK] Supabase write error:', error.message);
    return res.status(500).json({ error: error.message });
  }

  console.log(`[TIB-WEBHOOK] Access REVOKED for ${email} — subscription_active=false, session cleared`);

  return res.status(200).json({
    success: true,
    email,
    subscription_active: false,
    session_cleared: true,
    reason
  });
};
