import { NextResponse } from 'next/server'
import { readSessionEmail } from '@/lib/auth'

export async function GET() {
  const email = await readSessionEmail()
  return NextResponse.json({ email })
}
