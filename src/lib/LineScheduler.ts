import {
  createEmptyCard,
  fsrs,
  Rating,
  State,
  type Card as FsrsCard,
  type FSRS,
  type Grade,
} from 'ts-fsrs'
import type {
  LineOutcome,
  LineSrsState,
  LineSrsStateName,
} from './types.ts'

const OUTCOME_TO_RATING: Record<LineOutcome, Grade> = {
  pass_all_first: Rating.Good,
  pass_with_retry: Rating.Hard,
  fail: Rating.Again,
}

function fsrsStateToName(s: State): LineSrsStateName {
  switch (s) {
    case State.New:
      return 'new'
    case State.Learning:
      return 'learning'
    case State.Review:
      return 'review'
    case State.Relearning:
      return 'relearning'
  }
}

function nameToFsrsState(n: LineSrsStateName): State {
  switch (n) {
    case 'new':
      return State.New
    case 'learning':
      return State.Learning
    case 'review':
      return State.Review
    case 'relearning':
      return State.Relearning
  }
}

function fromFsrsCard(card: FsrsCard, consecutive_correct: number): LineSrsState {
  return {
    stability: card.stability,
    difficulty: card.difficulty,
    due: card.due,
    state: fsrsStateToName(card.state),
    last_review: card.last_review,
    reps: card.reps,
    lapses: card.lapses,
    consecutive_correct,
    learning_steps: card.learning_steps,
  }
}

function toFsrsCard(state: LineSrsState): FsrsCard {
  return {
    due: state.due,
    stability: state.stability,
    difficulty: state.difficulty,
    elapsed_days: 0,
    scheduled_days: 0,
    // Resuming at step 0 would re-schedule every Good at the short step
    // forever; the persisted index is what lets a line graduate to Review.
    learning_steps: state.learning_steps ?? 0,
    reps: state.reps,
    lapses: state.lapses,
    state: nameToFsrsState(state.state),
    last_review: state.last_review,
  }
}

export class LineScheduler {
  private readonly engine: FSRS = fsrs()

  initial(now: Date = new Date()): LineSrsState {
    return fromFsrsCard(createEmptyCard(now), 0)
  }

  next(
    state: LineSrsState,
    outcome: LineOutcome,
    now: Date = new Date(),
  ): LineSrsState {
    const fsrsCard = toFsrsCard(state)
    const rating = OUTCOME_TO_RATING[outcome]
    const { card } = this.engine.next(fsrsCard, now, rating)
    const consecutive_correct =
      outcome === 'fail' ? 0 : state.consecutive_correct + 1
    return fromFsrsCard(card, consecutive_correct)
  }
}
