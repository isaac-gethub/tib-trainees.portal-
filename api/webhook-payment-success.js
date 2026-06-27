// ═══════════════════════════════════════════════════════════════════════════
// TIB Systems Inc. — TIB-LMS-SUB-001-MASTER
// Webhook 1: Payment Successful
// Fires on EVERY successful monthly charge (Months 1–6)
// Deploy to: /api/webhook-payment-success.js in your Vercel project
// ═══════════════════════════════════════════════════════════════════════════
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const email      = req.body?.customer?.email;
  const paymentRef = req.body?.order?.id;
  const amount     = req.body?.pricePlan?.amount || 'unknown';
  if (!email) {
    console.error('[TIB-WEBHOOK] Missing email in payload:', JSON.stringify(req.body));
    return res.status(400).json({ error: 'Missing email in payload' });
  }
  console.log(`[TIB-WEBHOOK] Payment success — ${email} | ref: ${paymentRef} | amount: ${amount}`);
  const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true
    });
    if (createError) {
      console.error('[TIB-WEBHOOK] User creation error full:', JSON.stringify(createError));
      return res.status(500).json({ error: JSON.stringify(createError) });
  }
    let authUser = users.find(u => u.email === email);
  if (!authUser) {
    const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true
    });
    if (createError) {
      console.error('[TIB-WEBHOOK] User creation error:', createError.message);
      return res.status(500).json({ error: createError.message });
    }
    authUser = newUser.user;
  }
  const userId = authUser.id;
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + 30);
  const { error } = await supabase
    .from('user_profiles')
    .upsert({
      user_id:              userId,
      subscription_active:  true,
      subscription_expiry:  expiry.toISOString(),
      failed_payment_count: 0,
      payment_ref:          paymentRef
    });
  if (error) {
    console.error('[TIB-WEBHOOK] Supabase write error:', error.message);
    return res.status(500).json({ error: error.message });
  }
  return res.status(200).json({
    success: true,
    email,
    subscription_active: true,
    subscription_expiry: expiry.toISOString()
  });
};
