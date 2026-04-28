import { completeJson, MODELS, extractJsonObject } from '@/lib/anthropic'
import { z } from 'zod'

// What Haiku returns from the HTML. Several fields are tolerant of null
// because Haiku occasionally emits null where the source page omits a value
// (especially summary on cameo-only entries).
const tolerantString = (max: number) =>
  z
    .union([z.string(), z.null()])
    .transform((v) => (typeof v === 'string' ? v.slice(0, max) : ''))

const ingestedItemSchema = z.object({
  id: z.string().min(1).max(120),
  headline: z.string().min(1).max(500),
  summary: tolerantString(800),
  imageUrl: z.string().max(2000).nullable().optional(),
  category: z
    .enum(['product_launch', 'funding', 'cameo', 'pivot', 'culture', 'media'])
    .nullable()
    .optional(),
  tags: z.array(z.string().min(1).max(80)).max(12).default([]),
  people: z.array(z.string().min(1).max(120)).max(20).default([]),
  companies: z.array(z.string().min(1).max(120)).max(20).default([]),
  vcs: z.array(z.string().min(1).max(120)).max(20).default([]),
})

export const ingestResultSchema = z.object({
  items: z.array(ingestedItemSchema).max(80),
})

export type IngestedItem = z.infer<typeof ingestedItemSchema>
export type IngestResult = z.infer<typeof ingestResultSchema>

// Strip <script>/<style> blocks and collapse runs of whitespace so we don't
// burn input tokens on bundled JS or stylesheet noise. Keep tag structure
// intact — Haiku handles HTML fine and the markup helps it segment items.
export function compactHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const SYSTEM_RULES = `You are an HTML-to-JSON extractor for the Silicon Mania Weekly digest (https://www.siliconmania.tv/weekly). The page lists ~30-40 short SF tech-news items per week. Each entry typically has a headline, a 1-2 sentence summary, an image, and references named people / companies / VCs.

EXTRACT every item visible on the page into the schema below. Do NOT summarize or merge items. Preserve real names verbatim — first AND last name when given (e.g. "Sam Altman", "Peter Thiel", "Garry Tan"). Never archetype.

CATEGORY GUIDELINES (pick the single best fit; null if unclear):
- product_launch: a company or person ships / announces / opens-source a product, app, model, hardware
- funding: a round closes, a fund opens, a check is written, valuation news
- cameo: a named person does/says/wears something newsworthy without a clear product or funding angle (parties, podcasts, posts, public spats, sightings)
- pivot: a company changes direction, lays off, restructures, sunsets a product
- culture: SF-life, neighborhoods, restaurants, scene moments, AI-house culture
- media: TV/film/podcast/zine/newsletter/blog news about the SF tech ecosystem itself

TAGS: 3-6 short lowercase keyword tags per item (e.g. "ai", "robotics", "yc", "seed", "sand-hill", "dogpatch", "agents", "gpu", "chip"). Use kebab-case for multi-word.

PEOPLE / COMPANIES / VCS: real-name strings exactly as they appear in the digest (no titles, no descriptors). Use [] when none.

ID: stable kebab-case slug derived from the headline, ≤80 chars, no leading/trailing dashes (e.g. "openai-ships-coral-7b", "thiel-fund-new-defense-bet"). The same item must produce the same id on a re-ingest of the same page.

IMAGE URL: the absolute URL of the entry's primary image, or null if none. Hotlink — do NOT rewrite the host.

OUTPUT SHAPE (single JSON object, no prose, no fences, start with "{" end with "}"):
{ "items": [ { "id": ..., "headline": ..., "summary": ..., "imageUrl": ..., "category": ..., "tags": [...], "people": [...], "companies": [...], "vcs": [...] } ] }`

function parseIngestRaw(raw: string): IngestResult {
  let json: unknown
  try {
    json = extractJsonObject(raw)
  } catch (e) {
    console.warn('[refresh-weekly] JSON extraction failed. raw head:', raw.slice(0, 800))
    throw e
  }
  const result = ingestResultSchema.safeParse(json)
  if (!result.success) {
    console.warn(
      '[refresh-weekly] Zod validation failed. issues:',
      JSON.stringify(result.error.issues, null, 2),
    )
    throw result.error
  }
  return result.data
}

export async function extractItemsFromHtml(html: string): Promise<IngestResult> {
  const compact = compactHtml(html)
  const userBlock = `## DIGEST HTML
${compact}

Extract every distinct news item. Output the JSON object now.`

  return completeJson(
    {
      model: MODELS.scene, // Haiku 4.5 — task specified Haiku for ingest
      systemBlocks: [{ text: SYSTEM_RULES, cache: true }],
      userBlocks: [{ text: userBlock, cache: false }],
      // ~38 items × ~250 tokens each + envelope. 8K was being truncated mid-array.
      maxTokens: 16000,
      temperature: 0,
    },
    parseIngestRaw,
  )
}

// Sanitize the LLM-supplied id into a safe kebab-case slug bounded to 80
// chars. Idempotent — passing an already-clean slug returns it unchanged.
export function safeSlug(raw: string): string {
  const s = raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '')
  return s.length > 0 ? s : 'item'
}
