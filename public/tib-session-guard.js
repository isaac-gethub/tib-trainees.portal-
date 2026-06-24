// ═══════════════════════════════════════════════════════════════════════════
// TIB Systems Inc. — TIB-LMS-SUB-001-MASTER
// tib-session-guard.js — CORRECTED for user_profiles schema
// ═══════════════════════════════════════════════════════════════════════════

const TIB_SUPABASE_URL  = 'https://blfgwysgekfqhcafofhe.supabase.co';
const TIB_SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJsZmd3eXNnZWtmcWhjYWZvZmhlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDI4NjQ0OSwiZXhwIjoyMDk1ODYyNDQ5fQ.GKcryiAXbBeQnX700cfIpKcJRHa3mvC27j2f8vDDg78';

const _tibSupabase = supabase.createClient(TIB_SUPABASE_URL, TIB_SUPABASE_ANON);


// ═══════════════════════════════════════════════════════════════════════════
// 1. HELPER — Get user's IP address
// ═══════════════════════════════════════════════════════════════════════════
async function getUserIP() {
  try {
    const r = await fetch('https://api.ipify.org?format=json');
    const d = await r.json();
    return d.ip;
  } catch {
    return 'unknown';
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// 2. HELPER — Get user_id from Supabase Auth session
// user_profiles uses user_id (UUID) not email as the key.
// We read the current Supabase Auth session to get the UUID.
// ═══════════════════════════════════════════════════════════════════════════
async function _tibGetUserId() {
  const { data: { session } } = await _tibSupabase.auth.getSession();
  return session?.user?.id || null;
}


// ═══════════════════════════════════════════════════════════════════════════
// 3. tibSessionGuard()
// ═══════════════════════════════════════════════════════════════════════════
async function tibSessionGuard() {

  const localToken   = localStorage.getItem('tib_session_token');
  const currentEmail = localStorage.getItem('tib_user_email');

  if (!localToken || !currentEmail) {
    window.location.href = '/login';
    return false;
  }

  // Get user_id from Supabase Auth session
  const userId = await _tibGetUserId();
  if (!userId) {
    localStorage.clear();
    window.location.href = '/login?reason=error';
    return false;
  }

  // Fetch subscription + session state from user_profiles
  let data, error;
  try {
    const result = await _tibSupabase
      .from('user_profiles')
      .select('active_session_token, subscription_active, subscription_expiry, last_seen_at')
      .eq('user_id', userId)
      .maybeSingle();
    data  = result.data;
    error = result.error;
  } catch (e) {
    console.error('[TIB-GUARD] Network error:', e.message);
    return true; // Don't lock out on network error
  }

  if (error || !data) {
    localStorage.clear();
    window.location.href = '/login?reason=error';
    return false;
  }

  // RULE 1: Token mismatch = another device logged in
  if (data.active_session_token !== localToken) {
    localStorage.clear();
    window.location.href = '/login?reason=session_replaced';
    return false;
  }

  // RULE 2: Subscription not active
  if (!data.subscription_active) {
    window.location.href = '/login?reason=subscription_inactive';
    return false;
  }

  // RULE 3: Subscription expired
  if (data.subscription_expiry && new Date(data.subscription_expiry) < new Date()) {
    window.location.href = '/login?reason=subscription_expired';
    return false;
  }

  // RULE 4: Heartbeat update
  try {
    const ip = await getUserIP();
    await _tibSupabase
      .from('user_profiles')
      .update({
        last_seen_at: new Date().toISOString(),
        last_ip:      ip
      })
      .eq('user_id', userId);
  } catch (e) {
    console.warn('[TIB-GUARD] Heartbeat update failed:', e.message);
  }

  return true;
}


// ═══════════════════════════════════════════════════════════════════════════
// 4. tibLoginHandler(userEmail)
// ═══════════════════════════════════════════════════════════════════════════
async function tibLoginHandler(userEmail) {

  // Sign in via Supabase Auth to get user_id
  // NOTE: This assumes your LMS uses Supabase Auth for login.
  // If you use a custom password check, sign in here first, then proceed.
  const { data: authData, error: authError } = await _tibSupabase.auth.signInWithPassword({
    email:    userEmail,
    password: '__already_verified__' // placeholder — see note below
  });

  // ── Get user_id from current session ──────────────────────────────────
  const userId = await _tibGetUserId();
  if (!userId) {
    console.error('[TIB-LOGIN] No user_id available after login');
    alert('Login error — please try again.');
    return;
  }

  const newToken    = crypto.randomUUID();
  const fingerprint = btoa([
    navigator.userAgent,
    screen.width + 'x' + screen.height,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    navigator.language
  ].join('|'));
  const ip = await getUserIP();

  const { error } = await _tibSupabase
    .from('user_profiles')
    .update({
      active_session_token: newToken,
      session_created_at:   new Date().toISOString(),
      device_fingerprint:   fingerprint,
      login_ip:             ip,
      last_seen_at:         new Date().toISOString()
    })
    .eq('user_id', userId);

  if (error) {
    console.error('[TIB-LOGIN] Failed to write session token:', error.message);
    alert('Login error — please try again. Contact academy@tib-systems.com if the problem persists.');
    return;
  }

  localStorage.setItem('tib_session_token', newToken);
  localStorage.setItem('tib_user_email',    userEmail);

  window.location.href = '/student-console';
}


// ═══════════════════════════════════════════════════════════════════════════
// 5. tibLoadConsoleState()
// ═══════════════════════════════════════════════════════════════════════════
async function tibLoadConsoleState() {

  const userId = await _tibGetUserId();
  if (!userId) return;

  const { data } = await _tibSupabase
    .from('user_profiles')
    .select('subscription_expiry')
    .eq('user_id', userId)
    .maybeSingle();

  if (!data?.subscription_expiry) return;

  const expiry    = new Date(data.subscription_expiry);
  const today     = new Date();
  const msPerDay  = 1000 * 60 * 60 * 24;
  const daysLeft  = Math.ceil((expiry - today) / msPerDay);
  const formatted = expiry.toLocaleDateString('en-GB', {
    day: '2-digit', month: 'long', year: 'numeric'
  });

  const expiryEl = document.getElementById('expiry-date');
  const daysEl   = document.getElementById('days-remaining-display');
  if (expiryEl) expiryEl.textContent = formatted;
  if (daysEl)   daysEl.textContent   = `${daysLeft} day${daysLeft !== 1 ? 's' : ''} remaining`;

  if (daysLeft <= 30) {
    const banner     = document.getElementById('renewal-banner');
    const daysLeftEl = document.getElementById('days-left');
    if (daysLeftEl) daysLeftEl.textContent = daysLeft;
    if (banner) {
      banner.style.display = 'block';
      if (daysLeft <= 7) banner.style.background = '#C0392B';
    }
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// 6. Login page reason-code handler
// ═══════════════════════════════════════════════════════════════════════════
function tibHandleLoginReason() {
  const params = new URLSearchParams(window.location.search);
  const reason = params.get('reason');
  const msgEl  = document.getElementById('login-message');
  if (!reason || !msgEl) return;

  const messages = {
    session_replaced: `
      <strong>You have been signed out.</strong><br>
      Your account was accessed from another device. You have been signed out of this device.<br>
      If this was not you, please change your password immediately and contact
      <a href="mailto:academy@tib-systems.com">academy@tib-systems.com</a>.`,

    subscription_inactive: `
      <strong>Subscription not active.</strong><br>
      Your TIB All-Access subscription is not currently active.<br>
      <a href="https://all-access.tib-systems.com" style="font-weight:bold;">
      Subscribe to regain access →</a>`,

    subscription_expired: `
      <strong>Subscription expired.</strong><br>
      Your 6-month access period has ended.<br>
      <a href="https://all-access.tib-systems.com" style="font-weight:bold;">
      Renew your subscription →</a>`,

    error: `
      <strong>Session error.</strong><br>
      We could not verify your session. Please log in again.<br>
      If this problem persists, contact
      <a href="mailto:academy@tib-systems.com">academy@tib-systems.com</a>.`
  };

  const msg = messages[reason];
  if (msg) {
    msgEl.innerHTML = msg;
    msgEl.style.display = 'block';
  }
}

if (document.getElementById('login-message')) {
  tibHandleLoginReason();
}
