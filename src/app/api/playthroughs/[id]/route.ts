import { NextResponse, type NextRequest } from 'next/server'
import {
  finalizePlaythrough,
  getPlaythroughByIdAndEmail,
  updatePlaythroughArc,
} from '@/lib/playthroughs'
import { readSessionEmail } from '@/lib/auth'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  }

  const email = await readSessionEmail()
  if (!email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const item = await getPlaythroughByIdAndEmail(id, email)
    if (!item) {
      return NextResponse.json({ error: 'not found' }, { status: 404 })
    }
    return NextResponse.json({ item })
  } catch (err) {
    console.error('getPlaythroughByIdAndEmail failed', err)
    return NextResponse.json({ error: 'database error' }, { status: 500 })
  }
}

type Body = {
  arcJson?: unknown
  ending?: unknown
  epilogue?: unknown
  achievements?: unknown
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  return v.filter((x): x is string => typeof x === 'string')
}

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  }

  let body: Body = {}
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 })
  }

  const hasArc = body.arcJson !== undefined
  const ending = asString(body.ending)
  const wantsFinalize = ending !== undefined

  if (!hasArc && !wantsFinalize) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
  }

  try {
    if (hasArc) {
      const updated = await updatePlaythroughArc(id, body.arcJson)
      if (!updated) {
        return NextResponse.json({ error: 'not found' }, { status: 404 })
      }
    }

    if (wantsFinalize) {
      const finalized = await finalizePlaythrough({
        id,
        ending: ending!,
        epilogue: asString(body.epilogue) ?? null,
        achievements: asStringArray(body.achievements) ?? [],
      })
      if (!finalized) {
        return NextResponse.json({ error: 'not found' }, { status: 404 })
      }
      return NextResponse.json({ id: finalized.id, completedAt: finalized.completed_at })
    }

    return NextResponse.json({ id })
  } catch (err) {
    console.error('PATCH /api/playthroughs/[id] failed', err)
    return NextResponse.json({ error: 'database error' }, { status: 500 })
  }
}
