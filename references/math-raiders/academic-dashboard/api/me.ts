import type { VercelRequest, VercelResponse } from '@vercel/node';
import { parse } from 'cookie';
import { createHmac, timingSafeEqual } from 'crypto';

// Cookie signing secret - MUST be set in production
const COOKIE_SECRET = process.env.COOKIE_SECRET || 'dev-secret-change-in-production';

// Verify and extract email from signed session
function verifySession(cookie: string): string | null {
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

export default function handler(req: VercelRequest, res: VercelResponse) {
  const cookies = parse(req.headers.cookie || '');
  const signedSession = cookies.auth_session;

  if (!signedSession) {
    return res.json({ authenticated: false });
  }

  // Verify signature to prevent forgery
  const email = verifySession(signedSession);
  if (!email) {
    return res.json({ authenticated: false });
  }

  return res.json({ authenticated: true, email });
}
