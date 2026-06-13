export interface VariantLabelInput {
  line: { dfs_index: number; steps: Array<{ expected_san: string }> }
  chapter: { name: string; lineCount: number }
}

const PREVIEW_SAN_COUNT = 6

export function formatVariantLabel(input: VariantLabelInput): string {
  if (input.chapter.lineCount === 1) return input.chapter.name

  const sans = input.line.steps.map((s) => s.expected_san)
  const preview = sans.slice(0, PREVIEW_SAN_COUNT).join(' ')
  const hasMore = sans.length > PREVIEW_SAN_COUNT
  const ordinal = input.line.dfs_index + 1
  return hasMore
    ? `Variante ${ordinal}: ${preview} …`
    : `Variante ${ordinal}: ${preview}`
}
