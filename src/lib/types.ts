export type UserSide = 'white' | 'black' | 'stm'

export type LineSrsStateName = 'new' | 'learning' | 'review' | 'relearning'

export interface LineSrsState {
  stability: number
  difficulty: number
  due: Date
  state: LineSrsStateName
  last_review?: Date
  reps: number
  lapses: number
  consecutive_correct: number
  /**
   * FSRS short-term learning-step index. Without it a 'learning' line restarts
   * at step 0 on every review and never graduates to day-scale intervals.
   * Absent in states persisted before the column existed — treat as 0.
   */
  learning_steps?: number
}

export type LineOutcome = 'pass_all_first' | 'pass_with_retry' | 'fail'

export type AnswerVerdict =
  | { kind: 'correct'; san: string; fen_after: string }
  | {
      kind: 'refutation'
      san: string
      continuation: string[]
      comment?: string
    }
  | { kind: 'wrong'; played: string; expected_san: string }

export interface Chapter {
  id: string
  name: string
  user_side: UserSide
  intro_comment?: string
  card_ids: string[]
  line_ids: string[]
}

export interface Refutation {
  san: string
  continuation: string[]
  comment?: string
}

/** Chessground brush names; Lichess %cal/%csl colors G/R/B/Y map onto them. */
export type ShapeBrush = 'green' | 'red' | 'blue' | 'yellow'

/** Author-drawn board annotation: arrow when dest is set, square highlight otherwise. */
export interface BoardShape {
  brush: ShapeBrush
  orig: string
  dest?: string
}

export interface Card {
  id: string
  chapter_id: string
  fen_canonical: string
  refutations: Refutation[]
  comment?: string
  shapes?: BoardShape[]
}

export interface LineStep {
  card_id: string
  expected_san: string
}

export interface Line {
  id: string
  chapter_id: string
  dfs_index: number
  steps: LineStep[]
  intro_comment?: string
}

export type WarningCode =
  | 'pgn_parse_error'
  | 'z0_no_variation'
  | 'side_unresolved'
  | 'chapter_skipped'

export interface IngestWarning {
  code: WarningCode
  message: string
  chapter_name?: string
  detail?: unknown
}

export interface IngestResult {
  chapters: Chapter[]
  cards: Card[]
  lines: Line[]
  warnings: IngestWarning[]
  author?: string
}

export interface ChapterPreview {
  name: string
  starts_from_initial_position: boolean
}

export interface IngestOptions {
  resolveStartingSide?: (chapter: ChapterPreview) => UserSide
}
