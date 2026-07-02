import { masteryPredicateSql } from './MasteryEvaluator.ts'
import type { MoveMissKind } from './WeakPointDeck.ts'
import type { SqlAdapter, SqlStatement } from './SqlAdapter.ts'
import type {
  BoardShape,
  IngestResult,
  LineOutcome,
  LineSrsState,
  LineSrsStateName,
  Refutation,
  UserSide,
} from './types.ts'

// Persisted lines reference cards by integer DB id, distinct from the in-memory
// LineStep (string id from the ingestor).
export interface PersistedLineStep {
  card_id: number
  expected_san: string
}

export type ReviewRating = 'Again' | 'Hard' | 'Good' | 'Easy'

const DEFAULT_PROFILE = 'default'

// Current schema tables in reverse-dependency (child→parent) order. Deleting in
// this order satisfies the foreign keys. restoreAll wipes through it; keep it in
// sync when the schema gains a table.
const TABLES_CHILD_FIRST = [
  'move_misses',
  'puzzle_attempts',
  'review_events',
  'line_states',
  'lines',
  'cards',
  'chapters',
  'pgns',
] as const

export interface SavePgnInput {
  name: string
  source_path?: string
  /** Set when the course was imported from a Lichess study; enables duplicate detection and future sync. */
  lichess_study_id?: string
  /** Challenge course (tactics pack): new lines quiz blind instead of teaching. */
  is_challenge?: boolean
  result: IngestResult
}

export interface PgnSummary {
  id: number
  name: string
  imported_at: string
  chapter_count: number
  author: string | null
  is_challenge: boolean
}

export interface ChapterRow {
  id: number
  pgn_id: number
  name: string
  user_side: UserSide
  intro_comment: string | null
}

export interface PersistedCard {
  id: number
  chapter_id: number
  fen_canonical: string
  refutations: Refutation[]
  comment: string | null
  shapes: BoardShape[] | null
}

export interface PersistedLine {
  id: number
  chapter_id: number
  dfs_index: number
  steps: PersistedLineStep[]
  intro_comment: string | null
}

export interface PersistedLineState {
  line_id: number
  profile_id: string
  stability: number
  difficulty: number
  due: Date
  state: LineSrsStateName
  reps: number
  lapses: number
  consecutive_correct: number
  learning_steps: number
  last_review: Date | null
}

export interface LineRef {
  line_id: number
  chapter_id: number
}

export interface PgnCounters {
  total: number
  learned: number
  mastered: number
  due: number
  /** Earliest due among learned (non-archived) lines; null if none learned. */
  nextDueAt: Date | null
  /** Lines whose first-ever review event falls within the last 7 days. */
  learnedThisWeek: number
}

const EMPTY_PGN_COUNTERS: PgnCounters = {
  total: 0,
  learned: 0,
  mastered: 0,
  due: 0,
  nextDueAt: null,
  learnedThisWeek: 0,
}

export interface ArchivedLineEntry {
  line: PersistedLine
  chapter: { id: number; name: string; total_line_count: number }
  archived_at: Date
}

export interface DueLineGlobalRef {
  line_id: number
  chapter_id: number
  chapter_name: string
}

export interface LogReviewEventInput {
  line_id: number
  ts: Date
  outcome: LineOutcome
  retries_used_count: number
  rating: ReviewRating
  /** Wall time of the quiz walk in ms; absent for non-timed paths. */
  duration_ms?: number
  profile_id?: string
}

export interface NewMoveMiss {
  card_id: number
  line_id: number
  ts: Date
  kind: MoveMissKind
  played_san: string
  expected_san: string | null
  profile_id?: string
}

export interface MoveMissRow {
  id: number
  card_id: number
  line_id: number
  ts: Date
  kind: MoveMissKind
  played_san: string
  expected_san: string | null
}

export interface NewPuzzleAttempt {
  card_id: number
  ts: Date
  correct: boolean
  profile_id?: string
}

export interface PuzzleAttemptRow {
  id: number
  card_id: number
  ts: Date
  correct: boolean
}

interface CardRowRaw {
  id: number
  chapter_id: number
  fen_canonical: string
  refutations: string
  comment: string | null
  shapes: string | null
}

interface LineRowRaw {
  id: number
  chapter_id: number
  dfs_index: number
  steps: string
  intro_comment: string | null
}

interface LineStateRowRaw {
  line_id: number
  profile_id: string
  stability: number
  difficulty: number
  due: string
  state: LineSrsStateName
  reps: number
  lapses: number
  consecutive_correct: number
  learning_steps: number
  last_review: string | null
}

export class Repository {
  constructor(private readonly sql: SqlAdapter) {}

  /**
   * ALTER TABLE ADD COLUMN with the duplicate-column error as the expected
   * no-op (SQLite has no ADD COLUMN IF NOT EXISTS). Any other failure — disk
   * full, locked DB — must surface, not leave a silently incomplete schema.
   */
  private async addColumnIfMissing(alterSql: string): Promise<void> {
    try {
      await this.sql.execute(alterSql)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (!/duplicate column/i.test(message)) throw err
    }
  }

  async migrate(): Promise<void> {
    // Schema versioning. Pre-launch nuke: any DB without schema_meta or with
    // version < SCHEMA_VERSION is dropped and rebuilt from scratch (per the
    // line-as-srs-atom plan, v1 DBs are not migrated).
    const SCHEMA_VERSION = '4'
    await this.sql.execute(`
      CREATE TABLE IF NOT EXISTS schema_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `)
    const versionRows = await this.sql.select<{ value: string }>(
      `SELECT value FROM schema_meta WHERE key = 'version'`,
    )
    const currentVersion = versionRows[0]?.value ?? null
    if (currentVersion !== SCHEMA_VERSION) {
      // Drop every known table from any prior schema. Order matters because of
      // foreign keys; reverse-dependency order keeps SQLite happy.
      const dropTables = [
        'move_misses',
        'puzzle_attempts',
        'review_events',
        'line_states',
        'card_states',
        'lines',
        'lessons',
        'cards',
        'chapters',
        'pgns',
      ]
      for (const t of dropTables) {
        await this.sql.execute(`DROP TABLE IF EXISTS ${t}`)
      }
    }

    await this.sql.execute(`
      CREATE TABLE IF NOT EXISTS pgns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        source_path TEXT,
        author TEXT,
        lichess_study_id TEXT,
        is_challenge INTEGER NOT NULL DEFAULT 0,
        imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
    // Additive columns (post-v4, no data nuke): Lichess study origin and the
    // challenge-course flag.
    await this.addColumnIfMissing(
      `ALTER TABLE pgns ADD COLUMN lichess_study_id TEXT`,
    )
    await this.addColumnIfMissing(
      `ALTER TABLE pgns ADD COLUMN is_challenge INTEGER NOT NULL DEFAULT 0`,
    )
    await this.sql.execute(`
      CREATE TABLE IF NOT EXISTS chapters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pgn_id INTEGER NOT NULL REFERENCES pgns(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        user_side TEXT NOT NULL CHECK(user_side IN ('white', 'black', 'stm')),
        intro_comment TEXT
      )
    `)
    await this.sql.execute(`
      CREATE TABLE IF NOT EXISTS cards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
        fen_canonical TEXT NOT NULL,
        refutations TEXT NOT NULL DEFAULT '[]',
        comment TEXT,
        shapes TEXT,
        UNIQUE(chapter_id, fen_canonical)
      )
    `)
    // Additive column (post-v4, no data nuke): author-drawn board shapes from
    // %cal/%csl.
    await this.addColumnIfMissing(`ALTER TABLE cards ADD COLUMN shapes TEXT`)
    await this.sql.execute(
      `CREATE INDEX IF NOT EXISTS idx_cards_chapter ON cards(chapter_id)`,
    )
    await this.sql.execute(`
      CREATE TABLE IF NOT EXISTS lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
        dfs_index INTEGER NOT NULL,
        steps TEXT NOT NULL,
        intro_comment TEXT,
        is_archived INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT
      )
    `)
    await this.sql.execute(
      `CREATE INDEX IF NOT EXISTS idx_lines_chapter ON lines(chapter_id, dfs_index)`,
    )
    await this.sql.execute(`
      CREATE TABLE IF NOT EXISTS line_states (
        line_id INTEGER NOT NULL REFERENCES lines(id) ON DELETE CASCADE,
        profile_id TEXT NOT NULL DEFAULT 'default',
        stability REAL NOT NULL,
        difficulty REAL NOT NULL,
        due TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('new','learning','review','relearning')),
        reps INTEGER NOT NULL,
        lapses INTEGER NOT NULL,
        consecutive_correct INTEGER NOT NULL DEFAULT 0,
        learning_steps INTEGER NOT NULL DEFAULT 0,
        last_review TEXT,
        PRIMARY KEY (line_id, profile_id)
      )
    `)
    // Additive column (post-v4, no data nuke): FSRS learning-step index.
    await this.addColumnIfMissing(
      `ALTER TABLE line_states ADD COLUMN learning_steps INTEGER NOT NULL DEFAULT 0`,
    )
    await this.sql.execute(`
      CREATE TABLE IF NOT EXISTS review_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        line_id INTEGER NOT NULL REFERENCES lines(id) ON DELETE CASCADE,
        profile_id TEXT NOT NULL DEFAULT 'default',
        ts TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK(outcome IN ('pass_all_first','pass_with_retry','fail')),
        retries_used_count INTEGER NOT NULL,
        rating TEXT NOT NULL CHECK(rating IN ('Again','Hard','Good','Easy')),
        duration_ms INTEGER
      )
    `)
    // Additive column (post-v4, no data nuke): quiz wall time.
    await this.addColumnIfMissing(
      `ALTER TABLE review_events ADD COLUMN duration_ms INTEGER`,
    )
    await this.sql.execute(
      `CREATE INDEX IF NOT EXISTS idx_review_events_line ON review_events(line_id, profile_id, ts)`,
    )
    // Weak-point tracking (additive to schema v4; CREATE IF NOT EXISTS lets
    // existing DBs gain these without a version bump / data nuke).
    await this.sql.execute(`
      CREATE TABLE IF NOT EXISTS move_misses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        line_id INTEGER NOT NULL REFERENCES lines(id) ON DELETE CASCADE,
        profile_id TEXT NOT NULL DEFAULT 'default',
        ts TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('retry','double_fail','refutation')),
        played_san TEXT NOT NULL,
        expected_san TEXT
      )
    `)
    await this.sql.execute(
      `CREATE INDEX IF NOT EXISTS idx_move_misses_card ON move_misses(card_id, profile_id, ts)`,
    )
    await this.sql.execute(`
      CREATE TABLE IF NOT EXISTS puzzle_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        profile_id TEXT NOT NULL DEFAULT 'default',
        ts TEXT NOT NULL,
        correct INTEGER NOT NULL CHECK(correct IN (0,1))
      )
    `)
    await this.sql.execute(
      `CREATE INDEX IF NOT EXISTS idx_puzzle_attempts_card ON puzzle_attempts(card_id, profile_id, ts)`,
    )

    // Per-profile preferences (each profile owns its DB file). Deliberately
    // NOT in the version-nuke drop list: user prefs survive schema rebuilds.
    await this.sql.execute(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `)

    await this.sql.execute(
      `INSERT INTO schema_meta (key, value) VALUES ('version', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [SCHEMA_VERSION],
    )
  }

  async getSetting(key: string): Promise<string | null> {
    const rows = await this.sql.select<{ value: string }>(
      `SELECT value FROM settings WHERE key = ?`,
      [key],
    )
    return rows[0]?.value ?? null
  }

  async setSetting(key: string, value: string): Promise<void> {
    await this.sql.execute(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, value],
    )
  }

  // Multi-row insert batching. Each execute() is a full IPC round-trip
  // through Tauri, so importing a large PGN one row at a time is dominated by
  // per-call overhead. Chunk size keeps the bind-parameter count comfortably
  // under SQLite's historical 999-variable limit.
  private static readonly MAX_BATCH_PARAMS = 400

  private batchChunks(columnCount: number, rows: unknown[][]): unknown[][][] {
    const perChunk = Math.max(
      1,
      Math.floor(Repository.MAX_BATCH_PARAMS / columnCount),
    )
    const chunks: unknown[][][] = []
    for (let i = 0; i < rows.length; i += perChunk) {
      chunks.push(rows.slice(i, i + perChunk))
    }
    return chunks
  }

  private insertSql(
    table: string,
    columns: string[],
    rowCount: number,
  ): string {
    const row = `(${columns.map(() => '?').join(', ')})`
    const values = Array.from({ length: rowCount }, () => row).join(', ')
    return `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${values}`
  }

  private buildBatchInsert(
    table: string,
    columns: string[],
    rows: unknown[][],
  ): SqlStatement[] {
    return this.batchChunks(columns.length, rows).map((chunk) => ({
      sql: this.insertSql(table, columns, chunk.length),
      params: chunk.flat(),
    }))
  }

  private async batchInsert(
    table: string,
    columns: string[],
    rows: unknown[][],
  ): Promise<void> {
    for (const st of this.buildBatchInsert(table, columns, rows)) {
      await this.sql.execute(st.sql, st.params)
    }
  }

  /**
   * Batched insert that reports the generated ids, in input-row order.
   * RETURNING gives the ids back without a second query; within a single
   * INSERT statement SQLite assigns strictly ascending rowids, so sorting
   * each chunk's ids recovers the VALUES order (RETURNING output order is
   * formally unspecified).
   */
  private async batchInsertReturningIds(
    table: string,
    columns: string[],
    rows: unknown[][],
  ): Promise<number[]> {
    const ids: number[] = []
    for (const chunk of this.batchChunks(columns.length, rows)) {
      const returned = await this.sql.select<{ id: number }>(
        `${this.insertSql(table, columns, chunk.length)} RETURNING id`,
        chunk.flat(),
      )
      ids.push(...returned.map((r) => r.id).sort((a, b) => a - b))
    }
    return ids
  }

  async savePgn(input: SavePgnInput): Promise<number> {
    const { lastInsertId } = await this.sql.execute(
      `INSERT INTO pgns (name, source_path, author, lichess_study_id, is_challenge) VALUES (?, ?, ?, ?, ?)`,
      [
        input.name,
        input.source_path ?? null,
        input.result.author ?? null,
        input.lichess_study_id ?? null,
        input.is_challenge ? 1 : 0,
      ],
    )
    const pgnId = lastInsertId!

    const chapterIds = await this.batchInsertReturningIds(
      'chapters',
      ['pgn_id', 'name', 'user_side', 'intro_comment'],
      input.result.chapters.map((c) => [
        pgnId,
        c.name,
        c.user_side,
        c.intro_comment ?? null,
      ]),
    )
    const chapterIdMap = new Map<string, number>(
      input.result.chapters.map((c, i) => [c.id, chapterIds[i]]),
    )

    // Validate every referenced chapter/card BEFORE any card or line insert
    // runs, so a malformed ingest result rejects without partial rows (there
    // is no cross-statement transaction to roll back under plugin-sql).
    const cardRows = input.result.cards.map((card) => {
      const chapterDbId = chapterIdMap.get(card.chapter_id)
      if (chapterDbId === undefined) {
        throw new Error(
          `unknown chapter ${card.chapter_id} for card ${card.id}`,
        )
      }
      return [
        chapterDbId,
        card.fen_canonical,
        JSON.stringify(card.refutations),
        card.comment ?? null,
        card.shapes ? JSON.stringify(card.shapes) : null,
      ]
    })
    const cardIds = await this.batchInsertReturningIds(
      'cards',
      ['chapter_id', 'fen_canonical', 'refutations', 'comment', 'shapes'],
      cardRows,
    )
    const cardIdMap = new Map<string, number>(
      input.result.cards.map((c, i) => [c.id, cardIds[i]]),
    )

    const lineRows = input.result.lines.map((line) => {
      const chapterDbId = chapterIdMap.get(line.chapter_id)
      if (chapterDbId === undefined) {
        throw new Error(
          `unknown chapter ${line.chapter_id} for line ${line.id}`,
        )
      }
      const dbSteps = line.steps.map((s) => ({
        card_id: cardIdMap.get(s.card_id),
        expected_san: s.expected_san,
      }))
      if (dbSteps.some((s) => s.card_id === undefined)) {
        throw new Error(`line ${line.id} references unknown card`)
      }
      return [
        chapterDbId,
        line.dfs_index,
        JSON.stringify(dbSteps),
        line.intro_comment ?? null,
      ]
    })
    await this.batchInsert(
      'lines',
      ['chapter_id', 'dfs_index', 'steps', 'intro_comment'],
      lineRows,
    )

    return pgnId
  }

  async findPgnByLichessStudyId(
    studyId: string,
  ): Promise<{ id: number; name: string } | null> {
    const rows = await this.sql.select<{ id: number; name: string }>(
      `SELECT id, name FROM pgns WHERE lichess_study_id = ? ORDER BY id LIMIT 1`,
      [studyId],
    )
    return rows[0] ?? null
  }

  async listPgns(): Promise<PgnSummary[]> {
    const rows = await this.sql.select<
      Omit<PgnSummary, 'is_challenge'> & { is_challenge: number }
    >(
      `SELECT p.id, p.name, p.imported_at, p.author, p.is_challenge, COUNT(c.id) AS chapter_count
       FROM pgns p
       LEFT JOIN chapters c ON c.pgn_id = p.id
       GROUP BY p.id
       ORDER BY p.imported_at DESC, p.id DESC`,
    )
    return rows.map((r) => ({ ...r, is_challenge: r.is_challenge === 1 }))
  }

  async getChaptersForPgn(pgnId: number): Promise<ChapterRow[]> {
    return this.sql.select<ChapterRow>(
      `SELECT id, pgn_id, name, user_side, intro_comment FROM chapters WHERE pgn_id = ? ORDER BY id`,
      [pgnId],
    )
  }

  async listChapters(pgnId: number): Promise<ChapterRow[]> {
    return this.getChaptersForPgn(pgnId)
  }

  async getChapter(chapterId: number): Promise<ChapterRow | null> {
    const rows = await this.sql.select<ChapterRow>(
      `SELECT id, pgn_id, name, user_side, intro_comment FROM chapters WHERE id = ?`,
      [chapterId],
    )
    return rows[0] ?? null
  }

  async deletePgn(pgnId: number): Promise<void> {
    // Cascade deletes chapters → cards/lines → line_states/review_events via FK ON DELETE CASCADE.
    await this.sql.execute(`DELETE FROM pgns WHERE id = ?`, [pgnId])
  }

  async setChallengeMode(pgnId: number, isChallenge: boolean): Promise<void> {
    const result = await this.sql.execute(
      `UPDATE pgns SET is_challenge = ? WHERE id = ?`,
      [isChallenge ? 1 : 0, pgnId],
    )
    if (result.rowsAffected === 0) {
      throw new Error(`setChallengeMode: pgn ${pgnId} not found`)
    }
  }

  async renamePgn(pgnId: number, name: string): Promise<void> {
    const trimmed = name.trim()
    if (trimmed.length === 0) {
      throw new Error('renamePgn: name must not be empty')
    }
    const result = await this.sql.execute(
      `UPDATE pgns SET name = ? WHERE id = ?`,
      [trimmed, pgnId],
    )
    if (result.rowsAffected === 0) {
      throw new Error(`renamePgn: pgn ${pgnId} not found`)
    }
  }

  async dumpAll(): Promise<{
    pgns: unknown[]
    chapters: unknown[]
    cards: unknown[]
    lines: unknown[]
    line_states: unknown[]
    review_events: unknown[]
    move_misses: unknown[]
    puzzle_attempts: unknown[]
  }> {
    const pgns = await this.sql.select(`SELECT * FROM pgns`)
    const chapters = await this.sql.select(`SELECT * FROM chapters`)
    const cards = await this.sql.select(`SELECT * FROM cards`)
    const lines = await this.sql.select(`SELECT * FROM lines`)
    const line_states = await this.sql.select(`SELECT * FROM line_states`)
    const review_events = await this.sql.select(`SELECT * FROM review_events`)
    const move_misses = await this.sql.select(`SELECT * FROM move_misses`)
    const puzzle_attempts = await this.sql.select(
      `SELECT * FROM puzzle_attempts`,
    )
    return {
      pgns,
      chapters,
      cards,
      lines,
      line_states,
      review_events,
      move_misses,
      puzzle_attempts,
    }
  }

  async restoreAll(snap: {
    pgns: unknown[]
    chapters: unknown[]
    cards: unknown[]
    lines: unknown[]
    line_states: unknown[]
    review_events: unknown[]
    // Optional: backups predating weak-point tracking lack these.
    move_misses?: unknown[]
    puzzle_attempts?: unknown[]
  }): Promise<void> {
    // The whole restore — wipe plus reinsert — runs as ONE transaction via
    // executeAtomic. A crash or bad row can no longer leave a half-empty DB:
    // either the snapshot lands complete or the previous data stays.
    const statements: SqlStatement[] = TABLES_CHILD_FIRST.map((t) => ({
      sql: `DELETE FROM ${t}`,
      params: [],
    }))

    const rec = (row: unknown) => row as Record<string, unknown>
    statements.push(
      ...this.buildBatchInsert(
        'pgns',
        [
          'id',
          'name',
          'source_path',
          'author',
          'lichess_study_id',
          'is_challenge',
          'imported_at',
        ],
        snap.pgns.map(rec).map((r) => [
          r.id,
          r.name,
          r.source_path ?? null,
          r.author ?? null,
          // Backups predating the Lichess import restore with no study origin.
          r.lichess_study_id ?? null,
          // Backups predating challenge courses restore as study courses.
          r.is_challenge ?? 0,
          r.imported_at,
        ]),
      ),
      ...this.buildBatchInsert(
        'chapters',
        ['id', 'pgn_id', 'name', 'user_side', 'intro_comment'],
        snap.chapters
          .map(rec)
          .map((r) => [
            r.id,
            r.pgn_id,
            r.name,
            r.user_side,
            r.intro_comment ?? null,
          ]),
      ),
      ...this.buildBatchInsert(
        'cards',
        [
          'id',
          'chapter_id',
          'fen_canonical',
          'refutations',
          'comment',
          'shapes',
        ],
        snap.cards.map(rec).map((r) => [
          r.id,
          r.chapter_id,
          r.fen_canonical,
          r.refutations,
          r.comment ?? null,
          // Backups predating the shapes column restore without annotations.
          r.shapes ?? null,
        ]),
      ),
      ...this.buildBatchInsert(
        'lines',
        [
          'id',
          'chapter_id',
          'dfs_index',
          'steps',
          'intro_comment',
          'is_archived',
          'archived_at',
        ],
        snap.lines
          .map(rec)
          .map((r) => [
            r.id,
            r.chapter_id,
            r.dfs_index,
            r.steps,
            r.intro_comment ?? null,
            (r.is_archived as number | undefined) ?? 0,
            (r.archived_at as string | null | undefined) ?? null,
          ]),
      ),
      ...this.buildBatchInsert(
        'line_states',
        [
          'line_id',
          'profile_id',
          'stability',
          'difficulty',
          'due',
          'state',
          'reps',
          'lapses',
          'consecutive_correct',
          'learning_steps',
          'last_review',
        ],
        snap.line_states.map(rec).map((r) => [
          r.line_id,
          r.profile_id,
          r.stability,
          r.difficulty,
          r.due,
          r.state,
          r.reps,
          r.lapses,
          r.consecutive_correct,
          // Backups predating the learning-steps column restore at step 0.
          (r.learning_steps as number | undefined) ?? 0,
          r.last_review ?? null,
        ]),
      ),
      ...this.buildBatchInsert(
        'review_events',
        [
          'id',
          'line_id',
          'profile_id',
          'ts',
          'outcome',
          'retries_used_count',
          'rating',
          'duration_ms',
        ],
        snap.review_events.map(rec).map((r) => [
          r.id,
          r.line_id,
          r.profile_id,
          r.ts,
          r.outcome,
          r.retries_used_count,
          r.rating,
          // Backups predating the duration column restore untimed.
          r.duration_ms ?? null,
        ]),
      ),
      ...this.buildBatchInsert(
        'move_misses',
        [
          'id',
          'card_id',
          'line_id',
          'profile_id',
          'ts',
          'kind',
          'played_san',
          'expected_san',
        ],
        (snap.move_misses ?? [])
          .map(rec)
          .map((r) => [
            r.id,
            r.card_id,
            r.line_id,
            r.profile_id,
            r.ts,
            r.kind,
            r.played_san,
            r.expected_san ?? null,
          ]),
      ),
      ...this.buildBatchInsert(
        'puzzle_attempts',
        ['id', 'card_id', 'profile_id', 'ts', 'correct'],
        (snap.puzzle_attempts ?? [])
          .map(rec)
          .map((r) => [r.id, r.card_id, r.profile_id, r.ts, r.correct]),
      ),
    )

    await this.sql.executeAtomic(statements)
  }

  // Row → domain mappers. The steps-JSON decode and the TEXT→Date decode are
  // the only places these conversions live; every line / line_state getter
  // routes through them so a column or encoding change is a one-line edit.
  private mapLineRow(r: {
    id: number
    chapter_id: number
    dfs_index: number
    steps: string
    intro_comment: string | null
  }): PersistedLine {
    return {
      id: r.id,
      chapter_id: r.chapter_id,
      dfs_index: r.dfs_index,
      steps: JSON.parse(r.steps) as PersistedLineStep[],
      intro_comment: r.intro_comment,
    }
  }

  private mapLineStateRow(r: LineStateRowRaw): PersistedLineState {
    return {
      line_id: r.line_id,
      profile_id: r.profile_id,
      stability: r.stability,
      difficulty: r.difficulty,
      due: new Date(r.due),
      state: r.state,
      reps: r.reps,
      lapses: r.lapses,
      consecutive_correct: r.consecutive_correct,
      learning_steps: r.learning_steps,
      last_review: r.last_review ? new Date(r.last_review) : null,
    }
  }

  async getCardsForChapter(chapterId: number): Promise<PersistedCard[]> {
    const rows = await this.sql.select<CardRowRaw>(
      `SELECT id, chapter_id, fen_canonical, refutations, comment, shapes FROM cards WHERE chapter_id = ? ORDER BY id`,
      [chapterId],
    )
    return rows.map((r) => ({
      id: r.id,
      chapter_id: r.chapter_id,
      fen_canonical: r.fen_canonical,
      refutations: JSON.parse(r.refutations) as Refutation[],
      comment: r.comment,
      shapes: r.shapes ? (JSON.parse(r.shapes) as BoardShape[]) : null,
    }))
  }

  async getLine(lineId: number): Promise<PersistedLine | null> {
    const rows = await this.sql.select<LineRowRaw>(
      `SELECT id, chapter_id, dfs_index, steps, intro_comment FROM lines WHERE id = ?`,
      [lineId],
    )
    const r = rows[0]
    if (!r) return null
    return this.mapLineRow(r)
  }

  async getPgnIdForChapter(chapterId: number): Promise<number | null> {
    const rows = await this.sql.select<{ pgn_id: number }>(
      `SELECT pgn_id FROM chapters WHERE id = ?`,
      [chapterId],
    )
    return rows[0]?.pgn_id ?? null
  }

  async getLinesForChapter(chapterId: number): Promise<PersistedLine[]> {
    const rows = await this.sql.select<LineRowRaw>(
      `SELECT id, chapter_id, dfs_index, steps, intro_comment FROM lines WHERE chapter_id = ? AND is_archived = 0 ORDER BY dfs_index, id`,
      [chapterId],
    )
    return rows.map((r) => this.mapLineRow(r))
  }

  /**
   * Every active line of a PGN in one query (chapter, then dfs order) — the
   * sidebar groups them by chapter_id instead of issuing per-chapter reads.
   */
  async getLinesForPgn(pgnId: number): Promise<PersistedLine[]> {
    const rows = await this.sql.select<LineRowRaw>(
      `SELECT l.id, l.chapter_id, l.dfs_index, l.steps, l.intro_comment
       FROM lines l
       INNER JOIN chapters c ON c.id = l.chapter_id
       WHERE c.pgn_id = ? AND l.is_archived = 0
       ORDER BY l.chapter_id, l.dfs_index, l.id`,
      [pgnId],
    )
    return rows.map((r) => this.mapLineRow(r))
  }

  /** Companion to getLinesForPgn: all line states of a PGN in one query. */
  async getLineStatesForPgn(
    pgnId: number,
    profileId: string = DEFAULT_PROFILE,
  ): Promise<PersistedLineState[]> {
    const rows = await this.sql.select<LineStateRowRaw>(
      `SELECT ls.line_id, ls.profile_id, ls.stability, ls.difficulty, ls.due,
              ls.state, ls.reps, ls.lapses, ls.consecutive_correct, ls.learning_steps, ls.last_review
       FROM line_states ls
       INNER JOIN lines l ON l.id = ls.line_id
       INNER JOIN chapters c ON c.id = l.chapter_id
       WHERE c.pgn_id = ? AND ls.profile_id = ? AND l.is_archived = 0`,
      [pgnId, profileId],
    )
    return rows.map((r) => this.mapLineStateRow(r))
  }

  async getDominatedLinesForChapter(
    chapterId: number,
    profileId: string = DEFAULT_PROFILE,
  ): Promise<PersistedLine[]> {
    const rows = await this.sql.select<LineRowRaw>(
      `SELECT l.id, l.chapter_id, l.dfs_index, l.steps, l.intro_comment
       FROM lines l
       INNER JOIN line_states ls ON ls.line_id = l.id
       WHERE l.chapter_id = ?
         AND ls.profile_id = ?
         AND ${masteryPredicateSql('ls')}
       ORDER BY l.dfs_index, l.id`,
      [chapterId, profileId],
    )
    return rows.map((r) => this.mapLineRow(r))
  }

  async getLineStatesForChapter(
    chapterId: number,
    profileId: string = DEFAULT_PROFILE,
  ): Promise<PersistedLineState[]> {
    const rows = await this.sql.select<LineStateRowRaw>(
      `SELECT ls.line_id, ls.profile_id, ls.stability, ls.difficulty, ls.due,
              ls.state, ls.reps, ls.lapses, ls.consecutive_correct, ls.learning_steps, ls.last_review
       FROM line_states ls
       INNER JOIN lines l ON l.id = ls.line_id
       WHERE l.chapter_id = ? AND ls.profile_id = ? AND l.is_archived = 0`,
      [chapterId, profileId],
    )
    return rows.map((r) => this.mapLineStateRow(r))
  }

  async saveLineState(
    lineId: number,
    state: LineSrsState,
    profileId: string = DEFAULT_PROFILE,
  ): Promise<void> {
    await this.sql.execute(
      `INSERT INTO line_states
         (line_id, profile_id, stability, difficulty, due, state, reps, lapses, consecutive_correct, learning_steps, last_review)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(line_id, profile_id) DO UPDATE SET
         stability = excluded.stability,
         difficulty = excluded.difficulty,
         due = excluded.due,
         state = excluded.state,
         reps = excluded.reps,
         lapses = excluded.lapses,
         consecutive_correct = excluded.consecutive_correct,
         learning_steps = excluded.learning_steps,
         last_review = excluded.last_review`,
      [
        lineId,
        profileId,
        state.stability,
        state.difficulty,
        state.due.toISOString(),
        state.state,
        state.reps,
        state.lapses,
        state.consecutive_correct,
        state.learning_steps ?? 0,
        state.last_review ? state.last_review.toISOString() : null,
      ],
    )
  }

  async getLineState(
    lineId: number,
    profileId: string = DEFAULT_PROFILE,
  ): Promise<PersistedLineState | null> {
    const rows = await this.sql.select<LineStateRowRaw>(
      `SELECT line_id, profile_id, stability, difficulty, due, state, reps, lapses, consecutive_correct, learning_steps, last_review
       FROM line_states WHERE line_id = ? AND profile_id = ?`,
      [lineId, profileId],
    )
    if (rows.length === 0) return null
    return this.mapLineStateRow(rows[0])
  }

  async getDueLines(
    chapterId: number | null = null,
    now: Date = new Date(),
    profileId: string = DEFAULT_PROFILE,
  ): Promise<LineRef[]> {
    const sql =
      chapterId === null
        ? `SELECT ls.line_id AS line_id, l.chapter_id AS chapter_id
         FROM line_states ls
         INNER JOIN lines l ON l.id = ls.line_id
         WHERE ls.profile_id = ?
           AND ls.state != 'new'
           AND ls.due <= ?
           AND l.is_archived = 0
         ORDER BY ls.due ASC, ls.line_id ASC`
        : `SELECT ls.line_id AS line_id, l.chapter_id AS chapter_id
         FROM line_states ls
         INNER JOIN lines l ON l.id = ls.line_id
         WHERE l.chapter_id = ?
           AND ls.profile_id = ?
           AND ls.state != 'new'
           AND ls.due <= ?
           AND l.is_archived = 0
         ORDER BY ls.due ASC, ls.line_id ASC`
    const params =
      chapterId === null
        ? [profileId, now.toISOString()]
        : [chapterId, profileId, now.toISOString()]
    const rows = await this.sql.select<{ line_id: number; chapter_id: number }>(
      sql,
      params,
    )
    return rows.map((r) => ({ line_id: r.line_id, chapter_id: r.chapter_id }))
  }

  async getDueLinesAllChapters(
    now: Date = new Date(),
    profileId: string = DEFAULT_PROFILE,
  ): Promise<DueLineGlobalRef[]> {
    const rows = await this.sql.select<{
      line_id: number
      chapter_id: number
      chapter_name: string
    }>(
      `SELECT ls.line_id AS line_id,
              l.chapter_id AS chapter_id,
              c.name AS chapter_name
       FROM line_states ls
       INNER JOIN lines l ON l.id = ls.line_id
       INNER JOIN chapters c ON c.id = l.chapter_id
       WHERE ls.profile_id = ?
         AND ls.state != 'new'
         AND ls.due <= ?
         AND l.is_archived = 0
       ORDER BY ls.due ASC, ls.line_id ASC`,
      [profileId, now.toISOString()],
    )
    return rows.map((r) => ({
      line_id: r.line_id,
      chapter_id: r.chapter_id,
      chapter_name: r.chapter_name,
    }))
  }

  /**
   * First-try accuracy of a course, from its existing review events: how many
   * quiz completions were clean (`pass_all_first`) out of all attempts.
   * Surfaced on challenge-course headers; zero totals mean "no attempts yet".
   */
  async getFirstTryStatsForPgn(
    pgnId: number,
    profileId: string = DEFAULT_PROFILE,
  ): Promise<{ first_try: number; total: number }> {
    const rows = await this.sql.select<{ first_try: number; total: number }>(
      `SELECT
         COALESCE(SUM(CASE WHEN e.outcome = 'pass_all_first' THEN 1 ELSE 0 END), 0) AS first_try,
         COUNT(e.id) AS total
       FROM review_events e
       JOIN lines l ON l.id = e.line_id
       JOIN chapters ch ON ch.id = l.chapter_id
       WHERE ch.pgn_id = ? AND e.profile_id = ?`,
      [pgnId, profileId],
    )
    return rows[0] ?? { first_try: 0, total: 0 }
  }

  async logReviewEvent(input: LogReviewEventInput): Promise<void> {
    await this.sql.execute(
      `INSERT INTO review_events (line_id, profile_id, ts, outcome, retries_used_count, rating, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        input.line_id,
        input.profile_id ?? DEFAULT_PROFILE,
        input.ts.toISOString(),
        input.outcome,
        input.retries_used_count,
        input.rating,
        input.duration_ms ?? null,
      ],
    )
  }

  /**
   * Review events at or after `since`, each annotated with that line's
   * first-ever event timestamp (the line's "learned" moment). Feeds
   * DailySummary, which applies the local-midnight cutoff.
   */
  async getReviewActivitySince(
    since: Date,
    profileId: string = DEFAULT_PROFILE,
  ): Promise<{ lineId: number; ts: Date; firstEverTs: Date }[]> {
    const rows = await this.sql.select<{
      line_id: number
      ts: string
      first_ts: string
    }>(
      `SELECT re.line_id, re.ts, f.first_ts
       FROM review_events re
       INNER JOIN (
         SELECT line_id, MIN(ts) AS first_ts
         FROM review_events
         WHERE profile_id = ?
         GROUP BY line_id
       ) f ON f.line_id = re.line_id
       WHERE re.profile_id = ? AND re.ts >= ?
       ORDER BY re.ts`,
      [profileId, profileId, since.toISOString()],
    )
    return rows.map((r) => ({
      lineId: r.line_id,
      ts: new Date(r.ts),
      firstEverTs: new Date(r.first_ts),
    }))
  }

  async recordMoveMisses(misses: NewMoveMiss[]): Promise<void> {
    await this.batchInsert(
      'move_misses',
      [
        'card_id',
        'line_id',
        'profile_id',
        'ts',
        'kind',
        'played_san',
        'expected_san',
      ],
      misses.map((m) => [
        m.card_id,
        m.line_id,
        m.profile_id ?? DEFAULT_PROFILE,
        m.ts.toISOString(),
        m.kind,
        m.played_san,
        m.expected_san,
      ]),
    )
  }

  async getMoveMissesForPgn(
    pgnId: number,
    profileId: string = DEFAULT_PROFILE,
  ): Promise<MoveMissRow[]> {
    const rows = await this.sql.select<{
      id: number
      card_id: number
      line_id: number
      ts: string
      kind: MoveMissKind
      played_san: string
      expected_san: string | null
    }>(
      `SELECT m.id, m.card_id, m.line_id, m.ts, m.kind, m.played_san, m.expected_san
       FROM move_misses m
       INNER JOIN cards c ON c.id = m.card_id
       INNER JOIN chapters ch ON ch.id = c.chapter_id
       WHERE ch.pgn_id = ? AND m.profile_id = ?
       ORDER BY m.ts ASC, m.id ASC`,
      [pgnId, profileId],
    )
    return rows.map((r) => ({ ...r, ts: new Date(r.ts) }))
  }

  async recordPuzzleAttempt(attempt: NewPuzzleAttempt): Promise<void> {
    await this.sql.execute(
      `INSERT INTO puzzle_attempts (card_id, profile_id, ts, correct)
       VALUES (?, ?, ?, ?)`,
      [
        attempt.card_id,
        attempt.profile_id ?? DEFAULT_PROFILE,
        attempt.ts.toISOString(),
        attempt.correct ? 1 : 0,
      ],
    )
  }

  async getPuzzleAttemptsForPgn(
    pgnId: number,
    profileId: string = DEFAULT_PROFILE,
  ): Promise<PuzzleAttemptRow[]> {
    const rows = await this.sql.select<{
      id: number
      card_id: number
      ts: string
      correct: number
    }>(
      `SELECT a.id, a.card_id, a.ts, a.correct
       FROM puzzle_attempts a
       INNER JOIN cards c ON c.id = a.card_id
       INNER JOIN chapters ch ON ch.id = c.chapter_id
       WHERE ch.pgn_id = ? AND a.profile_id = ?
       ORDER BY a.ts ASC, a.id ASC`,
      [pgnId, profileId],
    )
    return rows.map((r) => ({
      id: r.id,
      card_id: r.card_id,
      ts: new Date(r.ts),
      correct: r.correct === 1,
    }))
  }

  async getChapterCounters(
    chapterId: number,
    now: Date = new Date(),
    profileId: string = DEFAULT_PROFILE,
  ): Promise<{
    total: number
    learned: number
    mastered: number
    due: number
  }> {
    const [{ n: total }] = await this.sql.select<{ n: number }>(
      `SELECT COUNT(*) AS n FROM lines WHERE chapter_id = ? AND is_archived = 0`,
      [chapterId],
    )
    const [{ n: learned }] = await this.sql.select<{ n: number }>(
      `SELECT COUNT(*) AS n
       FROM line_states ls
       INNER JOIN lines l ON l.id = ls.line_id
       WHERE l.chapter_id = ? AND ls.profile_id = ? AND ls.state != 'new'
         AND l.is_archived = 0`,
      [chapterId, profileId],
    )
    const [{ n: due }] = await this.sql.select<{ n: number }>(
      `SELECT COUNT(*) AS n
       FROM line_states ls
       INNER JOIN lines l ON l.id = ls.line_id
       WHERE l.chapter_id = ? AND ls.profile_id = ?
         AND ls.state != 'new' AND ls.due <= ? AND l.is_archived = 0`,
      [chapterId, profileId, now.toISOString()],
    )
    const [{ n: mastered }] = await this.sql.select<{ n: number }>(
      `SELECT COUNT(*) AS n
       FROM line_states ls
       INNER JOIN lines l ON l.id = ls.line_id
       WHERE l.chapter_id = ? AND ls.profile_id = ?
         AND ${masteryPredicateSql('ls')} AND l.is_archived = 0`,
      [chapterId, profileId],
    )
    return { total, learned, mastered, due }
  }

  async getNextLearnLineForPgn(
    pgnId: number,
    profileId: string = DEFAULT_PROFILE,
  ): Promise<LineRef | null> {
    const rows = await this.sql.select<{ line_id: number; chapter_id: number }>(
      `SELECT l.id AS line_id, l.chapter_id AS chapter_id
       FROM lines l
       INNER JOIN chapters c ON c.id = l.chapter_id
       LEFT JOIN line_states ls ON ls.line_id = l.id AND ls.profile_id = ?
       WHERE c.pgn_id = ? AND l.is_archived = 0 AND (ls.state IS NULL OR ls.state = 'new')
       ORDER BY c.id ASC, l.dfs_index ASC
       LIMIT 1`,
      [profileId, pgnId],
    )
    return rows[0] ?? null
  }

  async getNextDueLineForPgn(
    pgnId: number,
    now: Date = new Date(),
    profileId: string = DEFAULT_PROFILE,
  ): Promise<LineRef | null> {
    const rows = await this.sql.select<{ line_id: number; chapter_id: number }>(
      `SELECT l.id AS line_id, l.chapter_id AS chapter_id
       FROM lines l
       INNER JOIN chapters c ON c.id = l.chapter_id
       INNER JOIN line_states ls ON ls.line_id = l.id AND ls.profile_id = ?
       WHERE c.pgn_id = ? AND l.is_archived = 0 AND ls.state != 'new' AND ls.due <= ?
       ORDER BY c.id ASC, l.dfs_index ASC
       LIMIT 1`,
      [profileId, pgnId, now.toISOString()],
    )
    return rows[0] ?? null
  }

  async archiveLine(lineId: number, now: Date = new Date()): Promise<void> {
    await this.archiveLines([lineId], now)
  }

  async archiveLines(lineIds: number[], now: Date = new Date()): Promise<void> {
    if (lineIds.length === 0) return
    const placeholders = lineIds.map(() => '?').join(', ')
    await this.sql.execute(
      `UPDATE lines SET is_archived = 1, archived_at = ? WHERE id IN (${placeholders})`,
      [now.toISOString(), ...lineIds],
    )
  }

  async unarchiveLine(lineId: number): Promise<void> {
    await this.unarchiveLines([lineId])
  }

  async unarchiveLines(lineIds: number[]): Promise<void> {
    if (lineIds.length === 0) return
    const placeholders = lineIds.map(() => '?').join(', ')
    await this.sql.execute(
      `UPDATE lines SET is_archived = 0, archived_at = NULL WHERE id IN (${placeholders})`,
      lineIds,
    )
  }

  async deleteLineHard(lineId: number): Promise<void> {
    await this.deleteLinesHard([lineId])
  }

  async deleteLinesHard(lineIds: number[]): Promise<void> {
    if (lineIds.length === 0) return
    const placeholders = lineIds.map(() => '?').join(', ')
    // Validate all targets in a single SELECT before any DELETE runs. If
    // anything is missing or unarchived, the call rejects without touching
    // a single row — the validation IS the atomicity boundary, since Tauri
    // plugin-sql v2 cannot share a transaction across execute() calls.
    const rows = await this.sql.select<{ id: number; is_archived: number }>(
      `SELECT id, is_archived FROM lines WHERE id IN (${placeholders})`,
      lineIds,
    )
    const found = new Map(rows.map((r) => [r.id, r.is_archived]))
    for (const id of lineIds) {
      const archived = found.get(id)
      if (archived === undefined) {
        throw new Error(`deleteLinesHard: line ${id} not found`)
      }
      if (archived !== 1) {
        throw new Error(
          `deleteLinesHard: line ${id} is not archived; archive it first`,
        )
      }
    }
    // Children first, then parent; each statement is idempotent on retry.
    // puzzle_attempts hang off cards (chapter-scoped), not lines, so they
    // survive line deletion on purpose.
    await this.sql.execute(
      `DELETE FROM move_misses WHERE line_id IN (${placeholders})`,
      lineIds,
    )
    await this.sql.execute(
      `DELETE FROM review_events WHERE line_id IN (${placeholders})`,
      lineIds,
    )
    await this.sql.execute(
      `DELETE FROM line_states WHERE line_id IN (${placeholders})`,
      lineIds,
    )
    await this.sql.execute(
      `DELETE FROM lines WHERE id IN (${placeholders})`,
      lineIds,
    )
  }

  async getArchivedLinesForPgn(pgnId: number): Promise<ArchivedLineEntry[]> {
    const rows = await this.sql.select<{
      id: number
      chapter_id: number
      dfs_index: number
      steps: string
      intro_comment: string | null
      archived_at: string
      chapter_name: string
      chapter_total: number
    }>(
      `SELECT l.id, l.chapter_id, l.dfs_index, l.steps, l.intro_comment,
              l.archived_at, c.name AS chapter_name,
              (SELECT COUNT(*) FROM lines WHERE chapter_id = c.id) AS chapter_total
       FROM lines l
       INNER JOIN chapters c ON c.id = l.chapter_id
       WHERE c.pgn_id = ? AND l.is_archived = 1
       ORDER BY l.archived_at DESC, l.id DESC`,
      [pgnId],
    )
    return rows.map((r) => ({
      line: this.mapLineRow(r),
      chapter: {
        id: r.chapter_id,
        name: r.chapter_name,
        total_line_count: r.chapter_total,
      },
      archived_at: new Date(r.archived_at),
    }))
  }

  async getPgnCounters(
    pgnId: number,
    now: Date = new Date(),
    profileId: string = DEFAULT_PROFILE,
  ): Promise<PgnCounters> {
    const all = await this.getAllPgnCounters(now, profileId)
    return all.get(pgnId) ?? EMPTY_PGN_COUNTERS
  }

  /**
   * Counters for every PGN in the library at once — three GROUP BY queries
   * total instead of six per course, so the library screen (which re-polls
   * every 30s) stays flat as the collection grows. PGNs with no active lines
   * are absent from the map; callers default to EMPTY_PGN_COUNTERS semantics.
   */
  async getAllPgnCounters(
    now: Date = new Date(),
    profileId: string = DEFAULT_PROFILE,
  ): Promise<Map<number, PgnCounters>> {
    const totals = await this.sql.select<{ pgn_id: number; n: number }>(
      `SELECT c.pgn_id AS pgn_id, COUNT(*) AS n
       FROM lines l
       INNER JOIN chapters c ON c.id = l.chapter_id
       WHERE l.is_archived = 0
       GROUP BY c.pgn_id`,
    )
    const states = await this.sql.select<{
      pgn_id: number
      learned: number
      due: number
      mastered: number
      next_due: string | null
    }>(
      `SELECT c.pgn_id AS pgn_id,
              SUM(CASE WHEN ls.state != 'new' THEN 1 ELSE 0 END) AS learned,
              SUM(CASE WHEN ls.state != 'new' AND ls.due <= ? THEN 1 ELSE 0 END) AS due,
              SUM(CASE WHEN ${masteryPredicateSql('ls')} THEN 1 ELSE 0 END) AS mastered,
              MIN(CASE WHEN ls.state != 'new' THEN ls.due END) AS next_due
       FROM line_states ls
       INNER JOIN lines l ON l.id = ls.line_id
       INNER JOIN chapters c ON c.id = l.chapter_id
       WHERE ls.profile_id = ? AND l.is_archived = 0
       GROUP BY c.pgn_id`,
      [now.toISOString(), profileId],
    )
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const weekly = await this.sql.select<{ pgn_id: number; n: number }>(
      `SELECT pgn_id, COUNT(*) AS n FROM (
         SELECT c.pgn_id AS pgn_id, re.line_id
         FROM review_events re
         INNER JOIN lines l ON l.id = re.line_id
         INNER JOIN chapters c ON c.id = l.chapter_id
         WHERE re.profile_id = ? AND l.is_archived = 0
         GROUP BY re.line_id
         HAVING MIN(re.ts) >= ?
       )
       GROUP BY pgn_id`,
      [profileId, weekAgo.toISOString()],
    )

    const out = new Map<number, PgnCounters>()
    const entry = (pgnId: number): PgnCounters => {
      let e = out.get(pgnId)
      if (!e) {
        e = { ...EMPTY_PGN_COUNTERS }
        out.set(pgnId, e)
      }
      return e
    }
    for (const r of totals) entry(r.pgn_id).total = r.n
    for (const r of states) {
      const e = entry(r.pgn_id)
      e.learned = r.learned
      e.due = r.due
      e.mastered = r.mastered
      e.nextDueAt = r.next_due ? new Date(r.next_due) : null
    }
    for (const r of weekly) entry(r.pgn_id).learnedThisWeek = r.n
    return out
  }
}
