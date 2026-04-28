// ISO 8601 week date helpers. We tag every digest item with a "YYYY-Www"
// week key so multiple weeks can coexist in the table and the arc-gen
// pipeline can ask for the current week deterministically.

export function isoWeekOf(date: Date): string {
  // Copy so we don't mutate the caller's date.
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  // Thursday in current week decides the year (per ISO 8601).
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const year = d.getUTCFullYear()
  const yearStart = new Date(Date.UTC(year, 0, 1))
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${year}-W${String(weekNo).padStart(2, '0')}`
}

export function currentIsoWeek(): string {
  return isoWeekOf(new Date())
}
