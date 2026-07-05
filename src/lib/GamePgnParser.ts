import { parseGames } from '@mliebelt/pgn-parser'

/**
 * Parses played-game PGNs (Lichess/Chess.com exports, OTB files) into flat
 * mainline move lists plus the metadata Game Check needs. Unlike the study
 * PGNs PgnIngestor handles, games carry no variations worth keeping — only
 * the mainline is extracted.
 */
export interface ParsedGame {
  /** Stable identity for re-import dedupe: `lichess:<id>` when the Site tag
   * points at a Lichess game, otherwise a content hash. */
  dedupe_key: string
  site_url: string | null
  /** ISO timestamp when the export provides one (UTCDate/UTCTime or Date); null otherwise. */
  played_at: string | null
  white: string
  black: string
  result: string
  time_control: string | null
  /** False for variants (Chess960, …) and games from a custom position — their FENs mean nothing against a repertoire. */
  is_standard: boolean
  /** Which side the given username played; null when the name matches neither player. */
  user_color: 'white' | 'black' | null
  /** Raw mainline SANs as written in the export. */
  sans: string[]
  /** Reconstructed single-game PGN, kept whole for retroactive re-analysis. */
  pgn_text: string
}

// The mliebelt parser materializes typed tags: dates/times arrive as objects
// with a `value` field, some tags stay plain strings. Normalize both shapes.
function tagString(tags: Record<string, unknown>, name: string): string | null {
  const raw = tags[name]
  if (raw === undefined || raw === null) return null
  if (typeof raw === 'string') return raw
  if (typeof raw === 'object' && 'value' in raw) {
    const v = (raw as { value: unknown }).value
    return typeof v === 'string' ? v : null
  }
  return null
}

function toIsoPlayedAt(tags: Record<string, unknown>): string | null {
  const date = tagString(tags, 'UTCDate') ?? tagString(tags, 'Date')
  if (!date || date.includes('?')) return null
  const time = tagString(tags, 'UTCTime') ?? '00:00:00'
  const iso = `${date.replaceAll('.', '-')}T${time}Z`
  const parsed = new Date(iso)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

// djb2 over the identity-bearing parts; collisions across a personal game
// archive are not a realistic concern.
function contentHash(parts: string[]): string {
  let h = 5381
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) {
      h = ((h << 5) + h + part.charCodeAt(i)) | 0
    }
  }
  return `hash:${(h >>> 0).toString(36)}`
}

const LICHESS_GAME_URL = /lichess\.org\/([A-Za-z0-9]{8})\b/

interface MinimalGameMove {
  notation: { notation: string }
}

function reconstructPgn(
  tags: Record<string, unknown>,
  sans: string[],
  result: string,
): string {
  const KEEP = [
    'Event',
    'Site',
    'Date',
    'White',
    'Black',
    'Result',
    'UTCDate',
    'UTCTime',
    'Variant',
    'TimeControl',
    'Termination',
    'Link',
  ]
  const headers: string[] = []
  for (const name of KEEP) {
    const v = tagString(tags, name)
    if (v) headers.push(`[${name} "${v}"]`)
  }
  const movetext: string[] = []
  for (let i = 0; i < sans.length; i++) {
    if (i % 2 === 0) movetext.push(`${i / 2 + 1}.`)
    movetext.push(sans[i])
  }
  movetext.push(result)
  return `${headers.join('\n')}\n\n${movetext.join(' ')}\n`
}

/** "300+3" → "5+3", "600" → "10+0"; anything non-numeric stays as-is. */
export function formatTimeControl(tc: string | null): string {
  if (!tc) return '—'
  const m = /^(\d+)(?:\+(\d+))?$/.exec(tc)
  if (!m) return tc
  const base = Number(m[1])
  const inc = m[2] ?? '0'
  const minutes = base % 60 === 0 ? String(base / 60) : (base / 60).toFixed(1)
  return `${minutes}+${inc}`
}

export function parseGamesPgn(pgnText: string, username: string): ParsedGame[] {
  const games = parseGames(pgnText)
  const wanted = username.trim().toLowerCase()
  const out: ParsedGame[] = []

  for (const game of games) {
    const tags = (game.tags ?? {}) as Record<string, unknown>
    const white = tagString(tags, 'White') ?? '?'
    const black = tagString(tags, 'Black') ?? '?'
    const result = tagString(tags, 'Result') ?? '*'
    const site = tagString(tags, 'Site') ?? tagString(tags, 'Link')
    const variant = tagString(tags, 'Variant')
    const isStandard =
      (!variant || variant.toLowerCase() === 'standard') &&
      !tagString(tags, 'FEN')

    const sans = (game.moves as MinimalGameMove[]).map(
      (m) => m.notation.notation,
    )

    const lichessId = site ? LICHESS_GAME_URL.exec(site)?.[1] : undefined
    const dedupe_key = lichessId
      ? `lichess:${lichessId}`
      : contentHash([
          white,
          black,
          tagString(tags, 'Date') ?? '',
          tagString(tags, 'UTCTime') ?? '',
          sans.join(' '),
        ])

    let user_color: ParsedGame['user_color'] = null
    if (white.toLowerCase() === wanted) user_color = 'white'
    else if (black.toLowerCase() === wanted) user_color = 'black'

    out.push({
      dedupe_key,
      site_url: site && /^https?:\/\//.test(site) ? site : null,
      played_at: toIsoPlayedAt(tags),
      white,
      black,
      result,
      time_control: tagString(tags, 'TimeControl'),
      is_standard: isStandard,
      user_color,
      sans,
      pgn_text: reconstructPgn(tags, sans, result),
    })
  }
  return out
}
