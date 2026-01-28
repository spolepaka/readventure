import type { VercelRequest, VercelResponse } from '@vercel/node';
import { serialize } from 'cookie';
import { createHmac, timingSafeEqual } from 'crypto';

// Allowed emails - Set for O(1) lookup
const ALLOWED_EMAILS = new Set(
  (process.env.ALLOWED_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
);

// Cookie signing secret - MUST be set in production
const COOKIE_SECRET = process.env.COOKIE_SECRET || 'dev-secret-change-in-production';

// Sign an email with HMAC to prevent forgery
function signSession(email: string): string {
  const sig = createHmac('sha256', COOKIE_SECRET).update(email).digest('hex').slice(0, 16);
  return `${email}.${sig}`;
}

// Verify and extract email from signed session
export function verifySession(cookie: string): string | null {
  const lastDot = cookie.lastIndexOf('.');
  if (lastDot === -1) return null;
  
  const email = cookie.slice(0, lastDot);
  const sig = cookie.slice(lastDot + 1);
  const expected = createHmac('sha256', COOKIE_SECRET).update(email).digest('hex').slice(0, 16);
  
  // Constant-time comparison to prevent timing attacks
  if (sig.length !== expected.length) return null;
  
  const sigBuffer = Buffer.from(sig, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  
  if (!timingSafeEqual(sigBuffer, expectedBuffer)) {
    return null;
  }
  return email;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { credential } = req.body || {};
  if (!credential) {
    return res.status(400).json({ error: 'Missing credential' });
  }

  try {
    // Verify the Google ID token
    // Google's tokeninfo endpoint is the simplest verification - no library needed
    const verifyRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`);
    
    if (!verifyRes.ok) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const payload = await verifyRes.json();
    
    // Verify token was issued for our app (prevents token reuse from other apps)
    const expectedAud = process.env.VITE_GOOGLE_CLIENT_ID;
    if (expectedAud && payload.aud !== expectedAud) {
      console.warn(`[AUTH] Token audience mismatch: expected ${expectedAud}, got ${payload.aud}`);
      return res.status(401).json({ error: 'Invalid token audience' });
    }
    
    // Verify email is confirmed by Google
    if (payload.email_verified !== 'true' && payload.email_verified !== true) {
      return res.status(401).json({ error: 'Email not verified' });
    }
    
    const email = payload.email?.toLowerCase();

    // Check whitelist
    if (!email || !ALLOWED_EMAILS.has(email)) {
      return res.status(403).json({ error: 'Email not authorized' });
    }

    // Log successful login (audit trail)
    console.log(`[AUTH] Login: ${email} at ${new Date().toISOString()}`);

    // Set signed session cookie (prevents forgery)
    res.setHeader('Set-Cookie', serialize('auth_session', signSession(email), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 60 * 60 * 24 * 7, // 1 week
    }));

    return res.json({ success: true, email });
  } catch (err) {
    console.error('Google auth error:', err);
    return res.status(500).json({ error: 'Authentication failed' });
  }
}
