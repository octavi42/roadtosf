// Shared shape for one Silicon Mania Weekly digest item — used by the
// admin-ingest route, the DB layer, and the arc-prompt splicer.

export interface SMItem {
  week: string
  id: string
  headline: string
  summary: string
  imageUrl: string | null
  category: string | null
  tags: string[]
  people: string[]
  companies: string[]
  vcs: string[]
}
