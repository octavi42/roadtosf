import { NextResponse } from 'next/server'
import { clearSession } from '@/lib/auth'

export async function POST() {
  try {
    await clearSession()
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('auth/logout failed', err)
    return NextResponse.json({ error: 'logout failed' }, { status: 500 })
  }
}
