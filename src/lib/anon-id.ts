import { cookies } from 'next/headers'
import { randomUUID } from 'node:crypto'

const COOKIE_NAME = 'rsf_anon'
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function getOrCreateAnonId(): Promise<string> {
  const store = await cookies()
  const existing = store.get(COOKIE_NAME)?.value
  if (existing && UUID_RE.test(existing)) return existing

  const fresh = randomUUID()
  store.set(COOKIE_NAME, fresh, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ONE_YEAR_SECONDS,
  })
  return fresh
}

export async function readAnonId(): Promise<string | null> {
  const store = await cookies()
  const existing = store.get(COOKIE_NAME)?.value
  return existing && UUID_RE.test(existing) ? existing : null
}
