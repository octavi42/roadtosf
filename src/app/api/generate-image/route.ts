import { NextRequest, NextResponse } from 'next/server'
import {
  generateSceneImage,
  generateScenesParallel,
  generateHeroImage,
} from '@/lib/openai-image'
import { Archetype } from '@/lib/types'

export const maxDuration = 60 // Vercel hobby cap

type Quality = 'low' | 'medium' | 'high'

interface SceneRequestBody {
  mode: 'scene'
  scenePrompt: string
  archetype: Archetype
  quality?: Quality
}

interface ScenesBatchRequestBody {
  mode: 'scenes'
  scenes: Array<{ scenePrompt: string; archetype: Archetype; quality?: Quality }>
}

interface HeroRequestBody {
  mode: 'hero'
  prompt: string
  quality?: Quality
}

type RequestBody = SceneRequestBody | ScenesBatchRequestBody | HeroRequestBody

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
      })
      return NextResponse.json({ dataUrl: result.dataUrl, format: result.format })
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
        })),
      )
      const results = settled.map((r) =>
        r.status === 'fulfilled'
          ? { ok: true as const, dataUrl: r.value.dataUrl, format: r.value.format }
          : { ok: false as const, error: String(r.reason?.message ?? r.reason) },
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
      return NextResponse.json({ dataUrl: result.dataUrl, format: result.format })
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
