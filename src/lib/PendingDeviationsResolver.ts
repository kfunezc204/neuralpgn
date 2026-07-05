/**
 * Pending = computed − acted. Deviations are recomputed from scratch on every
 * view open; this resolver applies the persisted Drill/Dismiss verdicts so an
 * acted-on deviation can never resurface, no matter how the repertoire
 * changed in between.
 *
 * A deviation's identity is (game, card, played move). The card is matched
 * against EVERY course expecting a move at that position: if the action was
 * recorded when course A was primary and course A is later deleted, the same
 * deviation re-attributed to course B stays resolved.
 */
export interface DeviationActionLike {
  game_id: number
  card_id: number
  played_san: string
}

export class PendingDeviationsResolver {
  private readonly acted: Set<string>

  constructor(actions: DeviationActionLike[]) {
    this.acted = new Set(
      actions.map((a) => `${a.game_id}:${a.card_id}:${a.played_san}`),
    )
  }

  isPending(
    gameId: number,
    playedSan: string,
    expectedCardIds: number[],
  ): boolean {
    return !expectedCardIds.some((cardId) =>
      this.acted.has(`${gameId}:${cardId}:${playedSan}`),
    )
  }
}
