import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import {
  generateSceneImage,
  generateScenesParallel,
  generateHeroImage,
  type ImageFormat,
} from '@/lib/openai-image'
import { Archetype } from '@/lib/types'

export const maxDuration = 60 // Vercel hobby cap

type Quality = 'low' | 'medium' | 'high'

interface SceneRequestBody {
  mode: 'scene'
  scenePrompt: string
  archetype: Archetype
  quality?: Quality
  appearance?: string
  name?: string
}

interface ScenesBatchRequestBody {
  mode: 'scenes'
  scenes: Array<{
    scenePrompt: string
    archetype: Archetype
    quality?: Quality
    appearance?: string
    name?: string
  }>
}

interface HeroRequestBody {
  mode: 'hero'
  prompt: string
  quality?: Quality
}

type RequestBody = SceneRequestBody | ScenesBatchRequestBody | HeroRequestBody

const CONTENT_TYPE: Record<ImageFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

// Upload the b64-encoded image to Vercel Blob and return its public URL.
// Why: persisting data URLs in sessionStorage blew the 5MB quota and forced
// regeneration on every refresh. With a stable URL we can skip the strip
// entirely and rehydrate keeps the original asset.
//
// Local-dev fallback: if BLOB_READ_WRITE_TOKEN isn't set, return an inline
// data URL. Persistence-on-refresh stops working (the same problem the
// blob upload was added to fix) but the immediate render works, which is
// what local dev needs. Production sets the token and gets stable URLs.
async function uploadToBlob(b64: string, format: ImageFormat): Promise<string> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return `data:${CONTENT_TYPE[format]};base64,${b64}`
  }
  const bytes = Buffer.from(b64, 'base64')
  const filename = `scenes/${crypto.randomUUID()}.${format}`
  const blob = await put(filename, bytes, {
    access: 'public',
    contentType: CONTENT_TYPE[format],
    addRandomSuffix: false,
  })
  return blob.url
}

export async function POST(req: NextRequest) {
  try {
    const body: RequestBody = await req.json()

    if (body.mode === 'scene') {
      if (!body.scenePrompt || !body.archetype) {
        return NextResponse.json(
          { error: 'scenePrompt and archetype are required for scene mode' },
          { status: 400 },
        )
      }
      const result = await generateSceneImage({
        scenePrompt: body.scenePrompt,
        archetype: body.archetype,
        quality: body.quality ?? 'medium',
        appearance: body.appearance,
        name: body.name,
      })
      const url = await uploadToBlob(result.b64Json, result.format)
      return NextResponse.json({ url, format: result.format })
    }

    if (body.mode === 'scenes') {
      if (!Array.isArray(body.scenes) || body.scenes.length === 0) {
        return NextResponse.json(
          { error: 'scenes array is required and must be non-empty' },
          { status: 400 },
        )
      }
      const settled = await generateScenesParallel(
        body.scenes.map((s) => ({
          scenePrompt: s.scenePrompt,
          archetype: s.archetype,
          quality: s.quality ?? 'medium',
          appearance: s.appearance,
          name: s.name,
        })),
      )
      const results = await Promise.all(
        settled.map(async (r) => {
          if (r.status !== 'fulfilled') {
            return { ok: false as const, error: String(r.reason?.message ?? r.reason) }
          }
          try {
            const url = await uploadToBlob(r.value.b64Json, r.value.format)
            return { ok: true as const, url, format: r.value.format }
          } catch (err) {
            return {
              ok: false as const,
              error: err instanceof Error ? err.message : String(err),
            }
          }
        }),
      )
      return NextResponse.json({ results })
    }

    if (body.mode === 'hero') {
      if (!body.prompt) {
        return NextResponse.json(
          { error: 'prompt is required for hero mode' },
          { status: 400 },
        )
      }
      const result = await generateHeroImage({
        prompt: body.prompt,
        quality: body.quality ?? 'high',
      })
      const url = await uploadToBlob(result.b64Json, result.format)
      return NextResponse.json({ url, format: result.format })
    }

    return NextResponse.json(
      { error: 'Invalid mode. Use "scene", "scenes", or "hero".' },
      { status: 400 },
    )
  } catch (err) {
    console.error('[generate-image] Error:', err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
