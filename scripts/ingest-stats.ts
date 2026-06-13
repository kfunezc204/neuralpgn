import { readFileSync } from 'node:fs'
import { PgnIngestor } from '../src/lib/PgnIngestor.ts'

for (const file of process.argv.slice(2)) {
  const text = readFileSync(file, 'utf8')
  const t0 = performance.now()
  const result = new PgnIngestor().ingest(text, {
    resolveStartingSide: () => 'white',
  })
  const ms = (performance.now() - t0).toFixed(0)
  const warnCodes = new Map<string, number>()
  for (const w of result.warnings) {
    warnCodes.set(w.code, (warnCodes.get(w.code) ?? 0) + 1)
  }
  const emptyLines = result.lines.filter((l) => l.steps.length === 0).length
  const z0Steps = result.lines.filter((l) =>
    l.steps.some((s) => s.expected_san === 'Z0'),
  ).length
  const linesWithIntro = result.lines.filter((l) => l.intro_comment).length
  console.log(`=== ${file} (${ms}ms)`)
  console.log(`chapters: ${result.chapters.length}`)
  console.log(
    `cards: ${result.cards.length}  lines: ${result.lines.length}  empty: ${emptyLines}  z0-in-steps: ${z0Steps}  with-intro: ${linesWithIntro}`,
  )
  console.log(
    `warnings: ${result.warnings.length}`,
    Object.fromEntries(warnCodes),
  )
  for (const ch of result.chapters.slice(0, 10)) {
    console.log(`  - ${ch.name}: ${ch.line_ids.length} lines, side=${ch.user_side}`)
  }
}
