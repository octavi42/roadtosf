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

export type FinalizePlaythroughInput = {
  id: string
  ending: string
  epilogue?: string | null
  achievements?: string[]
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
