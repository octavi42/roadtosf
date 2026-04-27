import { cookies } from 'next/headers'
import { getIronSession, type IronSession, type SessionOptions } from 'iron-session'

export interface SessionData {
  email?: string
}

const COOKIE_NAME = 'rsf_session'
const TTL_SECONDS = 60 * 60 * 24 * 30 // 30 days

let cachedOptions: SessionOptions | null = null

function getOptions(): SessionOptions {
  if (cachedOptions) return cachedOptions
  const password = process.env.RTSF_SESSION_SECRET
  if (!password || password.length < 32) {
    throw new Error(
      'RTSF_SESSION_SECRET is missing or shorter than 32 chars. See .env.example.',
    )
  }
  cachedOptions = {
    cookieName: COOKIE_NAME,
    password,
    ttl: TTL_SECONDS,
    cookieOptions: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    },
  }
  return cachedOptions
}

async function getSession(): Promise<IronSession<SessionData>> {
  const store = await cookies()
  return getIronSession<SessionData>(store, getOptions())
}

export async function readSessionEmail(): Promise<string | null> {
  try {
    const session = await getSession()
    return typeof session.email === 'string' && session.email.length > 0
      ? session.email
      : null
  } catch (err) {
    console.error('readSessionEmail failed', err)
    return null
  }
}

export async function setSessionEmail(email: string): Promise<void> {
  const session = await getSession()
  session.email = email.toLowerCase()
  await session.save()
}

export async function clearSession(): Promise<void> {
  const session = await getSession()
  session.destroy()
}
