import { NextRequest, NextResponse } from 'next/server'
import { generateSceneImage, generateHeroImage } from '@/lib/openai-image'
import { Archetype } from '@/lib/types'

export const maxDuration = 60 // Vercel max for hobby plan

interface SceneRequestBody {
  mode: 'scene'
  scenePrompt: string
  archetype: Archetype
  quality?: 'low' | 'medium' | 'high'
}

interface HeroRequestBody {
  mode: 'hero'
  prompt: string
  quality?: 'low' | 'medium' | 'high'
}

type RequestBody = SceneRequestBody | HeroRequestBody

export async function POST(req: NextRequest) {
  try {
    const body: RequestBody = await req.json()

    if (body.mode === 'scene') {
      if (!body.scenePrompt || !body.archetype) {
        return NextResponse.json(
          { error: 'scenePrompt and archetype are required for scene mode' },
          { status: 400 }
        )
      }
      const result = await generateSceneImage({
        scenePrompt: body.scenePrompt,
        archetype: body.archetype,
        quality: body.quality ?? 'medium',
      })
      return NextResponse.json({ dataUrl: result.dataUrl, format: result.format })
    }

    if (body.mode === 'hero') {
      if (!body.prompt) {
        return NextResponse.json(
          { error: 'prompt is required for hero mode' },
          { status: 400 }
        )
      }
      const result = await generateHeroImage({
        prompt: body.prompt,
        quality: body.quality ?? 'high',
      })
      return NextResponse.json({ dataUrl: result.dataUrl, format: result.format })
    }

    return NextResponse.json({ error: 'Invalid mode. Use "scene" or "hero".' }, { status: 400 })
  } catch (err) {
    console.error('[generate-image] Error:', err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
