#!/usr/bin/env node
// Scrape recent SF startup-story sources, LLM-summarize each into a ≤220-char
// `beat`, and upsert into sf_stories.
//
// Sources (LORE_SYSTEM.md §2.3, NO Twitter — explicitly excluded):
//   - HN Algolia API: hn.algolia.com/api/v1/search
//   - Reddit JSON   : r/startups, r/SanFrancisco, r/ycombinator, r/VentureCapital
//   - Substack RSS  : Pirate Wires, Newcomer, Big Technology, Lenny's,
//                     The Generalist, Stratechery
//
// Run:  npm run scrape:stories
// Or :  node --env-file=.env.local scripts/scrape-stories.mjs
// Tune: STORIES_PER_SOURCE=20  (default 12)
//       STORIES_DRY_RUN=1      (skip DB writes)

import { neon } from '@neondatabase/serverless'
import Anthropic from '@anthropic-ai/sdk'

const HAIKU = 'claude-haiku-4-5-20251001'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL not set. Add to .env.local — see .env.example.')
  process.exit(1)
}

const apiKey = process.env.ANTHROPIC_API_KEY
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY not set. Add to .env.local.')
  process.exit(1)
}

const sql = neon(url)
const anthropic = new Anthropic({ apiKey })

const PER_SOURCE = Number.parseInt(process.env.STORIES_PER_SOURCE ?? '12', 10)
const DRY_RUN = process.env.STORIES_DRY_RUN === '1'

// Sources --------------------------------------------------------------

const HN_QUERIES = [
  'San Francisco startup',
  'YC startup',
  'AI startup founder',
  'a16z',
  'Sequoia',
  'pivot',
]

const REDDIT_FEEDS = [
  'https://www.reddit.com/r/startups/top/.json?t=week',
  'https://www.reddit.com/r/SanFrancisco/top/.json?t=week',
  'https://www.reddit.com/r/ycombinator/top/.json?t=week',
  'https://www.reddit.com/r/VentureCapital/top/.json?t=week',
]

const SUBSTACK_FEEDS = [
  ['pirate-wires',   'https://www.piratewires.com/feed'],
  ['newcomer',       'https://www.newcomer.co/feed'],
  ['big-technology', 'https://www.bigtechnology.com/feed'],
  ['lennys',         'https://www.lennysnewsletter.com/feed'],
  ['the-generalist', 'https://www.readthegeneralist.com/feed'],
  ['stratechery',    'https://stratechery.com/feed/'],
]

// Helpers --------------------------------------------------------------

function safeSlug(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96)
}

function isoDateOf(ms) {
  const d = new Date(ms)
  return d.toISOString().slice(0, 10)
}

function decodeHtmlEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
}

function stripTags(s) {
  return String(s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

// HN ------------------------------------------------------------------

async function fetchHN() {
  const out = []
  const seen = new Set()
  for (const q of HN_QUERIES) {
    const u = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story&hitsPerPage=20&numericFilters=points>20`
    try {
      const res = await fetch(u, { headers: { 'user-agent': 'roadtosf-lore-bot/0.1' } })
      if (!res.ok) {
        console.warn(`hn ${q}: HTTP ${res.status}`)
        continue
      }
      const json = await res.json()
      const hits = Array.isArray(json.hits) ? json.hits : []
      for (const h of hits) {
        if (!h.objectID || seen.has(h.objectID)) continue
        seen.add(h.objectID)
        const headline = h.title ?? h.story_title ?? ''
        if (!headline) continue
        const url = h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`
        const created = h.created_at_i ? h.created_at_i * 1000 : Date.now()
        out.push({
          source: 'hn',
          rawId: h.objectID,
          headline,
          excerpt: h.story_text ? stripTags(decodeHtmlEntities(h.story_text)).slice(0, 1200) : '',
          url,
          createdMs: created,
          tagsHint: ['hn'],
        })
      }
    } catch (e) {
      console.warn(`hn ${q}: ${e.message}`)
    }
  }
  return out.slice(0, PER_SOURCE * 2)
}

// Reddit --------------------------------------------------------------

async function fetchReddit() {
  const out = []
  for (const u of REDDIT_FEEDS) {
    try {
      const res = await fetch(u, {
        headers: {
          'user-agent': 'roadtosf-lore-bot/0.1 by /u/anon',
          'accept': 'application/json',
        },
      })
      if (!res.ok) {
        console.warn(`reddit ${u}: HTTP ${res.status}`)
        continue
      }
      const json = await res.json()
      const children = json?.data?.children ?? []
      for (const c of children) {
        const d = c?.data
        if (!d || d.over_18 || d.stickied) continue
        const headline = String(d.title ?? '').trim()
        if (!headline) continue
        out.push({
          source: 'reddit',
          rawId: `${d.subreddit}-${d.id}`,
          headline,
          excerpt: stripTags(decodeHtmlEntities(d.selftext ?? '')).slice(0, 1500),
          url: `https://reddit.com${d.permalink}`,
          createdMs: (d.created_utc ?? Date.now() / 1000) * 1000,
          tagsHint: ['reddit', d.subreddit?.toLowerCase()].filter(Boolean),
        })
      }
    } catch (e) {
      console.warn(`reddit ${u}: ${e.message}`)
    }
  }
  return out.slice(0, PER_SOURCE * 2)
}

// Substack RSS --------------------------------------------------------

function parseRssItems(xml) {
  const items = []
  const re = /<item\b[\s\S]*?<\/item>/g
  const matches = xml.match(re) ?? []
  for (const block of matches) {
    const title = (block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) ?? [])[1] ?? ''
    const link = (block.match(/<link>([\s\S]*?)<\/link>/) ?? [])[1] ?? ''
    const guid = (block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/) ?? [])[1] ?? link
    const pubDate = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) ?? [])[1] ?? ''
    const desc =
      (block.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/) ?? [])[1] ?? ''
    const content =
      (block.match(/<content:encoded>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/content:encoded>/) ?? [])[1] ?? ''
    items.push({
      title: stripTags(decodeHtmlEntities(title)).trim(),
      link: link.trim(),
      guid: guid.trim(),
      pubDate,
      excerpt: stripTags(decodeHtmlEntities(content || desc)).slice(0, 1800),
    })
  }
  return items
}

async function fetchSubstack() {
  const out = []
  for (const [slug, u] of SUBSTACK_FEEDS) {
    try {
      const res = await fetch(u, {
        headers: { 'user-agent': 'roadtosf-lore-bot/0.1', 'accept': 'application/rss+xml' },
      })
      if (!res.ok) {
        console.warn(`substack ${slug}: HTTP ${res.status}`)
        continue
      }
      const xml = await res.text()
      const items = parseRssItems(xml)
      for (const it of items.slice(0, 8)) {
        if (!it.title) continue
        const created = it.pubDate ? Date.parse(it.pubDate) : Date.now()
        if (Number.isNaN(created)) continue
        out.push({
          source: `substack-${slug}`,
          rawId: it.guid || it.link,
          headline: it.title,
          excerpt: it.excerpt,
          url: it.link || u,
          createdMs: created,
          tagsHint: ['substack', slug],
        })
      }
    } catch (e) {
      console.warn(`substack ${slug}: ${e.message}`)
    }
  }
  return out
}

// LLM beat summarizer -------------------------------------------------

const TONES = ['cynical', 'earnest', 'hype', 'absurd', 'wistful']
const ARCHETYPES = ['vc', 'cofounder', 'reporter', 'hater', 'mentor']
const SUMMARY_SYSTEM = `You convert a single startup-news item into a tight one-sentence retelling for a satirical SF founder game.

Output a single JSON object only. No prose, no fences. Start with "{" end with "}".
{
  "beat": string,                            // ≤220 chars, ONE sentence, present tense, no quotes, no emojis
  "tone": "cynical"|"earnest"|"hype"|"absurd"|"wistful",
  "applicable_archetypes": string[],         // subset of: vc, cofounder, reporter, hater, mentor
  "tags": string[]                           // 2-6 lowercase kebab-case keywords (e.g. ai, fundraising, pivot)
}

RULES:
- Real names (founders, VCs, companies) MAY appear verbatim if present in the source.
- The beat must be ≤220 chars. If the source is long, distill ruthlessly.
- "applicable_archetypes" lists which character roles in the game this story works for. Funding stories → vc. Layoff/pivot stories → hater or cofounder. Profile/scoop → reporter. Wisdom-thread or YC essay → mentor. Pick the 1-3 best fits.
- Avoid headline copy-paste. Re-phrase as a satirical micro-summary.
- Never invent details not in the source.`

function extractJson(raw) {
  let s = String(raw).trim()
  if (s.startsWith('```')) s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('no json object')
  return JSON.parse(s.slice(start, end + 1).replace(/,(\s*[}\]])/g, '$1'))
}

async function summarize(item) {
  const userBlock = `## SOURCE
Source: ${item.source}
Headline: ${item.headline}
URL: ${item.url}
${item.excerpt ? `Excerpt: ${item.excerpt}` : '(no excerpt)'}

Tag hints from feed: ${item.tagsHint.join(', ') || '(none)'}

Output the JSON object now.`

  const resp = await anthropic.messages.create({
    model: HAIKU,
    max_tokens: 400,
    temperature: 0,
    system: [{ type: 'text', text: SUMMARY_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: [{ type: 'text', text: userBlock }] }],
  })
  const block = resp.content.find((b) => b.type === 'text')
  if (!block) throw new Error('no text block')
  const json = extractJson(block.text)
  let beat = String(json.beat ?? '').replace(/\s+/g, ' ').trim()
  if (beat.length > 220) beat = beat.slice(0, 217).replace(/[\s,;:.!\-—]+$/, '') + '…'
  const tone = TONES.includes(json.tone) ? json.tone : 'cynical'
  const arches = Array.isArray(json.applicable_archetypes)
    ? json.applicable_archetypes.filter((a) => ARCHETYPES.includes(a))
    : []
  const tags = Array.isArray(json.tags)
    ? [...new Set(json.tags.map((t) => String(t).toLowerCase().replace(/\s+/g, '-')).filter(Boolean))].slice(0, 8)
    : []
  return { beat, tone, applicable_archetypes: arches, tags }
}

// Main ----------------------------------------------------------------

async function main() {
  console.log(`scrape-stories: PER_SOURCE=${PER_SOURCE}${DRY_RUN ? ' (dry run)' : ''}`)

  const [hn, reddit, substack] = await Promise.all([
    fetchHN(),
    fetchReddit(),
    fetchSubstack(),
  ])
  console.log(`fetched: hn=${hn.length} reddit=${reddit.length} substack=${substack.length}`)

  // Cap per-source so a single feed can't drown out the others.
  const pool = [
    ...hn.slice(0, PER_SOURCE),
    ...reddit.slice(0, PER_SOURCE),
    ...substack.slice(0, PER_SOURCE),
  ]
  console.log(`summarizing ${pool.length} items via Haiku…`)

  let inserted = 0
  let updated = 0
  let failed = 0

  for (const item of pool) {
    const dateSlug = isoDateOf(item.createdMs)
    const id = `${item.source}-${dateSlug}-${safeSlug(item.headline)}`.slice(0, 120)
    try {
      const { beat, tone, applicable_archetypes, tags } = await summarize(item)
      if (!beat || beat.length < 10) {
        console.warn(`skip ${id}: beat too short`)
        failed++
        continue
      }
      if (DRY_RUN) {
        console.log(`(dry) ${id} | ${tone} | ${beat}`)
        inserted++
        continue
      }
      const before = await sql`SELECT 1 FROM sf_stories WHERE id = ${id}`
      const isNew = before.length === 0
      await sql`
        INSERT INTO sf_stories (id, beat, tone, source_url, applicable_archetypes, tags, scraped_at)
        VALUES (${id}, ${beat}, ${tone}, ${item.url}, ${applicable_archetypes}, ${tags}, NOW())
        ON CONFLICT (id) DO UPDATE SET
          beat = EXCLUDED.beat,
          tone = EXCLUDED.tone,
          source_url = EXCLUDED.source_url,
          applicable_archetypes = EXCLUDED.applicable_archetypes,
          tags = EXCLUDED.tags,
          scraped_at = NOW()
      `
      if (isNew) inserted++
      else updated++
    } catch (e) {
      failed++
      console.warn(`fail ${id}: ${e.message}`)
    }
  }

  console.log(`sf_stories: ${inserted} inserted, ${updated} updated, ${failed} failed (of ${pool.length})`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
