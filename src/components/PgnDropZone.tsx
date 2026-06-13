import { useEffect, useState } from 'react'

interface PgnDropZoneProps {
  /** Called with the dropped .pgn's name and text content. */
  onPgnText: (fileName: string, text: string) => void
}

/**
 * Window-level drag & drop for .pgn files. Renders nothing until a file drag
 * enters the window, then a full-screen affordance; rejects non-.pgn drops
 * with a brief inline message instead of navigating anywhere.
 */
export function PgnDropZone({ onPgnText }: PgnDropZoneProps) {
  const [dragging, setDragging] = useState(false)
  const [rejected, setRejected] = useState(false)

  useEffect(() => {
    // dragenter/dragleave fire for every child node; counting keeps the
    // overlay stable while the cursor crosses inner elements.
    let depth = 0

    function hasFiles(e: DragEvent): boolean {
      return Array.from(e.dataTransfer?.types ?? []).includes('Files')
    }

    function onDragEnter(e: DragEvent) {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth++
      setDragging(true)
    }
    function onDragOver(e: DragEvent) {
      if (!hasFiles(e)) return
      e.preventDefault()
    }
    function onDragLeave(e: DragEvent) {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    function onDrop(e: DragEvent) {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setDragging(false)
      const file = e.dataTransfer?.files?.[0]
      if (!file) return
      if (!/\.pgn$/i.test(file.name)) {
        setRejected(true)
        setTimeout(() => setRejected(false), 2500)
        return
      }
      void file.text().then((text) => onPgnText(file.name, text))
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [onPgnText])

  if (!dragging && !rejected) return null
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[900] flex items-center justify-center bg-black/50 backdrop-blur-sm"
    >
      <div className="rounded-xl border-2 border-dashed border-accent bg-surface-1/90 px-8 py-6 text-center">
        {rejected ? (
          <p className="text-sm font-medium text-danger">
            Solo archivos .pgn
          </p>
        ) : (
          <>
            <p className="text-3xl">♞</p>
            <p className="mt-2 text-sm font-medium text-ink">
              Suelta el archivo .pgn para importarlo
            </p>
          </>
        )}
      </div>
    </div>
  )
}
