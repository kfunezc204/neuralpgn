export function quizSideAnnouncement(fen: string): string {
  const side = fen.split(' ')[1]
  return side === 'b' ? 'Black to move!' : 'White to move!'
}
