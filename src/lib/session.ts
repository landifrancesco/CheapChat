import { SignJWT, jwtVerify, JWTPayload } from 'jose';
import { cookies } from 'next/headers';
import { v4 as uuidv4 } from 'uuid';

export type SessionPayload = JWTPayload & {
  visitorId: string;
};

const SECRET_KEY = new TextEncoder().encode(
  process.env.SESSION_SECRET || 'fallback-secret-for-dev-only'
);

export async function createSession(visitorId?: string) {
  const finalVisitorId = visitorId || uuidv4();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  
  const token = await new SignJWT({ visitorId: finalVisitorId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(SECRET_KEY);

  const cookieStore = await cookies();
  cookieStore.set('cheapchat_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    expires: expiresAt,
    sameSite: 'lax',
    path: '/',
  });

  return finalVisitorId;
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get('cheapchat_session')?.value;

  return verifySessionToken(sessionToken);
}

export function getCookieValue(cookieHeader: string | null | undefined, key: string) {
  if (!cookieHeader) {
    return null;
  }

  const match = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${key}=`));

  return match ? decodeURIComponent(match.slice(key.length + 1)) : null;
}

export async function verifySessionToken(sessionToken: string | null | undefined): Promise<SessionPayload | null> {
  if (!sessionToken) {
    return null;
  }

  try {
    const { payload } = await jwtVerify(sessionToken, SECRET_KEY);
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

export async function getSessionFromCookieHeader(cookieHeader: string | null | undefined): Promise<SessionPayload | null> {
  return verifySessionToken(getCookieValue(cookieHeader, 'cheapchat_session'));
}

export async function getSessionFromRequest(request: Request | { headers: Headers }): Promise<SessionPayload | null> {
  return getSessionFromCookieHeader(request.headers.get('cookie'));
}

export async function deleteSession() {
  const cookieStore = await cookies();
  cookieStore.delete('cheapchat_session');
}
