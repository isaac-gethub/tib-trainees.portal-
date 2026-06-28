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

  const email = req.body?.customer?.email || req.body?.contact?.email;
  const paymentRef = req.body?.order?.id;
  const amount     = req.body?.pricePlan?.amount || 'unknown';
const firstName = req.body?.customer?.fields?.first_name || req.body?.contact?.fields?.first_name || '';
const lastName  = req.body?.customer?.fields?.surname || req.body?.contact?.fields?.surname || '';
const fullName  = `${firstName} ${lastName}`.trim();
  
  if (!email) {
    console.error('[TIB-WEBHOOK] Missing email in payload:', JSON.stringify(req.body));
    return res.status(400).json({ error: 'Missing email in payload' });
  }

  console.log(`[TIB-WEBHOOK] Payment success — ${email} | ref: ${paymentRef} | amount: ${amount}`);

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

  // Find existing user
  const listRes  = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`, {
    headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` }
  });
  const listData = await listRes.json();
  let userId;

  const matchedUser = listData.users && listData.users.find(u => u.email === email);
  if (matchedUser) {
    userId = matchedUser.id;
    console.log(`[TIB-WEBHOOK] Existing user found — ${userId}`);
  }
  else {
    // Create new user
    const createRes  = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, email_confirm: true })
    });
    const createData = await createRes.json();
        console.log('[TIB-WEBHOOK] Create response:', JSON.stringify(createData));
    if (!createData.id) {
      console.error('[TIB-WEBHOOK] User creation error:', JSON.stringify(createData));
      return res.status(500).json({ error: JSON.stringify(createData) });
    }
    userId = createData.id;
    console.log(`[TIB-WEBHOOK] New user created — ${userId}`);
  }

  // Write enrollment to user_profiles
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + 30);

const { error } = await supabase
    .from('user_profiles')
    .upsert({
      user_id:              userId,
      subscription_active:  true,
      subscription_expiry:  expiry.toISOString(),
      failed_payment_count: 0,
      payment_ref:          paymentRef,
      full_name:            fullName
    });

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
