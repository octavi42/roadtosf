'use client'

import { useState } from 'react'
import { Archetype } from '@/lib/types'
import { ARCHETYPES } from '@/lib/archetypes'

type Mode = 'scene' | 'hero'
type Quality = 'low' | 'medium' | 'high'

interface TestResult {
  dataUrl: string
  format: string
  elapsed: number
}

export default function TestImagePage() {
  const [mode, setMode] = useState<Mode>('scene')
  const [scenePrompt, setScenePrompt] = useState(
    'A tense late-night meeting in a San Francisco co-working space. The character is explaining a controversial pivot idea using a whiteboard full of chaotic diagrams.'
  )
  const [archetype, setArchetype] = useState<Archetype>('vc')
  const [heroPrompt, setHeroPrompt] = useState(
    'A triumphant founder standing on the steps of the New York Stock Exchange, confetti raining down, their startup logo projected on the building facade. Silicon Valley satire. Cinematic.'
  )
  const [quality, setQuality] = useState<Quality>('low')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<TestResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleGenerate() {
    setLoading(true)
    setResult(null)
    setError(null)
    const start = Date.now()

    try {
      const body =
        mode === 'scene'
          ? { mode, scenePrompt, archetype, quality }
          : { mode, prompt: heroPrompt, quality }

      const res = await fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Unknown error')

      setResult({ dataUrl: data.dataUrl, format: data.format, elapsed: Date.now() - start })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-8 font-mono">
      <h1 className="text-2xl font-bold mb-2 text-emerald-400">🖼 Image Gen Test</h1>
      <p className="text-zinc-500 text-sm mb-8">
        gpt-image-2 pipeline test — scene (edit with portrait ref) + hero (generate)
      </p>

      {/* Mode toggle */}
      <div className="flex gap-3 mb-6">
        {(['scene', 'hero'] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-4 py-2 rounded text-sm font-bold uppercase tracking-wider border transition-colors ${
              mode === m
                ? 'bg-emerald-500 text-black border-emerald-500'
                : 'bg-transparent text-zinc-400 border-zinc-700 hover:border-zinc-500'
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      {/* Quality selector */}
      <div className="mb-6">
        <label className="block text-xs text-zinc-500 mb-2 uppercase tracking-wider">Quality</label>
        <div className="flex gap-3">
          {(['low', 'medium', 'high'] as Quality[]).map((q) => (
            <button
              key={q}
              onClick={() => setQuality(q)}
              className={`px-3 py-1 rounded text-sm border transition-colors ${
                quality === q
                  ? 'bg-amber-500 text-black border-amber-500'
                  : 'bg-transparent text-zinc-400 border-zinc-700 hover:border-zinc-500'
              }`}
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      {mode === 'scene' && (
        <>
          {/* Archetype selector */}
          <div className="mb-6">
            <label className="block text-xs text-zinc-500 mb-2 uppercase tracking-wider">
              Archetype
            </label>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(ARCHETYPES) as Archetype[]).map((a) => (
                <button
                  key={a}
                  onClick={() => setArchetype(a)}
                  className={`px-3 py-1 rounded text-sm border transition-colors ${
                    archetype === a
                      ? 'bg-blue-500 text-white border-blue-500'
                      : 'bg-transparent text-zinc-400 border-zinc-700 hover:border-zinc-500'
                  }`}
                >
                  {ARCHETYPES[a].name} ({a})
                </button>
              ))}
            </div>
          </div>

          {/* Scene prompt */}
          <div className="mb-6">
            <label className="block text-xs text-zinc-500 mb-2 uppercase tracking-wider">
              Scene Prompt
            </label>
            <textarea
              value={scenePrompt}
              onChange={(e) => setScenePrompt(e.target.value)}
              rows={4}
              className="w-full max-w-2xl bg-zinc-900 border border-zinc-700 rounded p-3 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500 resize-none"
            />
          </div>
        </>
      )}

      {mode === 'hero' && (
        <div className="mb-6">
          <label className="block text-xs text-zinc-500 mb-2 uppercase tracking-wider">
            Hero Image Prompt
          </label>
          <textarea
            value={heroPrompt}
            onChange={(e) => setHeroPrompt(e.target.value)}
            rows={4}
            className="w-full max-w-2xl bg-zinc-900 border border-zinc-700 rounded p-3 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500 resize-none"
          />
        </div>
      )}

      {/* Generate button */}
      <button
        onClick={handleGenerate}
        disabled={loading}
        className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-black font-bold rounded transition-colors mb-8"
      >
        {loading ? 'Generating...' : 'Generate Image'}
      </button>

      {/* Loading state */}
      {loading && (
        <div className="mb-8">
          <div className="text-zinc-400 text-sm animate-pulse">
            Calling gpt-image-2... this takes 5–15s
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-8 p-4 bg-red-950 border border-red-800 rounded text-red-300 text-sm">
          <span className="font-bold">Error: </span>{error}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="space-y-4">
          <div className="flex gap-6 text-sm text-zinc-400">
            <span>
              Format: <span className="text-zinc-100">{result.format}</span>
            </span>
            <span>
              Elapsed: <span className="text-emerald-400 font-bold">{(result.elapsed / 1000).toFixed(1)}s</span>
            </span>
          </div>
          <img
            src={result.dataUrl}
            alt="Generated scene"
            className="rounded-lg border border-zinc-800 max-w-xl w-full"
          />
          <a
            href={result.dataUrl}
            download={`test-${mode}-${Date.now()}.${result.format}`}
            className="inline-block px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded text-sm text-zinc-300 transition-colors"
          >
            Download image
          </a>
        </div>
      )}
    </div>
  )
}
