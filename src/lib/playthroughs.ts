import { getSql } from './db'

export type Playthrough = {
  id: string
  created_at: string
}

export type CreatePlaythroughInput = {
  anonId: string
  startupName?: string | null
  startupDescription?: string | null
  selfDescription?: string | null
  flavorTags?: string[]
  introTranscript?: string | null
}

export async function createPlaythrough(input: CreatePlaythroughInput): Promise<Playthrough> {
  const sql = getSql()
  const rows = await sql`
    INSERT INTO playthroughs (
      anon_id,
      startup_name,
      startup_description,
      self_description,
      flavor_tags,
      intro_transcript
    ) VALUES (
      ${input.anonId},
      ${input.startupName ?? null},
      ${input.startupDescription ?? null},
      ${input.selfDescription ?? null},
      ${JSON.stringify(input.flavorTags ?? [])}::jsonb,
      ${input.introTranscript ?? null}
    )
    RETURNING id, created_at
  `
  const row = rows[0] as { id: string; created_at: string }
  return row
}

export type LogSceneEventInput = {
  playthroughId: string
  sceneNumber: number
  dialogue?: string | null
  choicesShown?: unknown
  choicePicked?: string | null
  freeText?: string | null
  wasTimeout?: boolean
  timeToChooseMs?: number | null
  statDeltas?: Record<string, number>
  tonalFlag?: string | null
}

export async function logSceneEvent(input: LogSceneEventInput): Promise<{ id: string }> {
  const sql = getSql()
  const rows = await sql`
    INSERT INTO scene_events (
      playthrough_id,
      scene_number,
      dialogue,
      choices_shown,
      choice_picked,
      free_text,
      was_timeout,
      time_to_choose_ms,
      stat_deltas,
      tonal_flag
    ) VALUES (
      ${input.playthroughId},
      ${input.sceneNumber},
      ${input.dialogue ?? null},
      ${JSON.stringify(input.choicesShown ?? [])}::jsonb,
      ${input.choicePicked ?? null},
      ${input.freeText ?? null},
      ${input.wasTimeout ?? false},
      ${input.timeToChooseMs ?? null},
      ${JSON.stringify(input.statDeltas ?? {})}::jsonb,
      ${input.tonalFlag ?? null}
    )
    RETURNING id
  `
  return rows[0] as { id: string }
}

export async function updatePlaythroughArc(id: string, arcJson: unknown): Promise<{ id: string } | null> {
  const sql = getSql()
  const rows = await sql`
    UPDATE playthroughs
    SET arc_json = ${JSON.stringify(arcJson)}::jsonb
    WHERE id = ${id}
    RETURNING id
  `
  return (rows[0] as { id: string } | undefined) ?? null
}

export type MarkPaidInput = {
  id: string
  stripeSessionId: string
  email?: string | null
}

export async function markPlaythroughPaid(
  input: MarkPaidInput,
): Promise<{ id: string; paid_at: string } | null> {
  const sql = getSql()
  const email = input.email && input.email.length > 0 ? input.email : null
  const rows = await sql`
    UPDATE playthroughs SET
      is_paid = TRUE,
      paid_at = COALESCE(paid_at, NOW()),
      stripe_session_id = ${input.stripeSessionId},
      email = COALESCE(email, ${email})
    WHERE id = ${input.id}
    RETURNING id, paid_at
  `
  return (rows[0] as { id: string; paid_at: string } | undefined) ?? null
}

export async function hasPaidPlaythroughForEmail(email: string): Promise<boolean> {
  const sql = getSql()
  const rows = await sql`
    SELECT 1
    FROM playthroughs
    WHERE LOWER(email) = LOWER(${email})
      AND paid_at IS NOT NULL
    LIMIT 1
  `
  return rows.length > 0
}

export type RedeemByEmailInput = {
  playthroughId: string
  email: string
}

export async function redeemPlaythroughByEmail(
  input: RedeemByEmailInput,
): Promise<{ id: string; paid_at: string } | null> {
  const sql = getSql()
  // Two-step (Neon HTTP doesn't expose transactions): confirm a prior paid
  // row exists for this email, then flip the current playthrough.
  const found = await hasPaidPlaythroughForEmail(input.email)
  if (!found) return null
  const rows = await sql`
    UPDATE playthroughs SET
      is_paid = TRUE,
      paid_at = COALESCE(paid_at, NOW()),
      email = COALESCE(email, ${input.email})
    WHERE id = ${input.playthroughId}
    RETURNING id, paid_at
  `
  return (rows[0] as { id: string; paid_at: string } | undefined) ?? null
}

export type FinalizePlaythroughInput = {
  id: string
  ending: string
  epilogue?: string | null
  achievements?: string[]
}

export type PlaythroughSummary = {
  id: string
  startup_name: string | null
  ending: string | null
  epilogue: string | null
  achievements: string[]
  completed_at: string
}

export async function listPlaythroughsByEmail(
  email: string,
): Promise<PlaythroughSummary[]> {
  const sql = getSql()
  const rows = await sql`
    SELECT id, startup_name, ending, epilogue, achievements, completed_at
    FROM playthroughs
    WHERE LOWER(email) = LOWER(${email})
      AND completed_at IS NOT NULL
    ORDER BY completed_at DESC
    LIMIT 100
  `
  return rows.map((row) => {
    const r = row as {
      id: string
      startup_name: string | null
      ending: string | null
      epilogue: string | null
      achievements: unknown
      completed_at: string
    }
    return {
      id: r.id,
      startup_name: r.startup_name,
      ending: r.ending,
      epilogue: r.epilogue,
      achievements: Array.isArray(r.achievements)
        ? (r.achievements as string[])
        : [],
      completed_at: r.completed_at,
    }
  })
}

export async function getPlaythroughByIdAndEmail(
  id: string,
  email: string,
): Promise<PlaythroughSummary | null> {
  const sql = getSql()
  const rows = await sql`
    SELECT id, startup_name, ending, epilogue, achievements, completed_at
    FROM playthroughs
    WHERE id = ${id}
      AND LOWER(email) = LOWER(${email})
      AND completed_at IS NOT NULL
    LIMIT 1
  `
  if (rows.length === 0) return null
  const r = rows[0] as {
    id: string
    startup_name: string | null
    ending: string | null
    epilogue: string | null
    achievements: unknown
    completed_at: string
  }
  return {
    id: r.id,
    startup_name: r.startup_name,
    ending: r.ending,
    epilogue: r.epilogue,
    achievements: Array.isArray(r.achievements)
      ? (r.achievements as string[])
      : [],
    completed_at: r.completed_at,
  }
}

export async function finalizePlaythrough(
  input: FinalizePlaythroughInput,
): Promise<{ id: string; completed_at: string } | null> {
  const sql = getSql()
  const rows = await sql`
    UPDATE playthroughs SET
      ending = ${input.ending},
      epilogue = ${input.epilogue ?? null},
      achievements = ${JSON.stringify(input.achievements ?? [])}::jsonb,
      completed_at = COALESCE(completed_at, NOW())
    WHERE id = ${input.id}
    RETURNING id, completed_at
  `
  return (rows[0] as { id: string; completed_at: string } | undefined) ?? null
}
