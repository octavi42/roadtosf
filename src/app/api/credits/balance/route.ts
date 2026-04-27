import { NextResponse } from 'next/server'
import { readAnonId } from '@/lib/anon-id'
import { readSessionEmail } from '@/lib/auth'
import { getBalance } from '@/lib/credits'

export async function GET() {
  const [anonId, email] = await Promise.all([readAnonId(), readSessionEmail()])
  try {
    const credits = await getBalance({ anonId, email })
    return NextResponse.json({ credits })
  } catch (err) {
    console.error('credits/balance failed', err)
    return NextResponse.json({ error: 'database error' }, { status: 500 })
  }
}
