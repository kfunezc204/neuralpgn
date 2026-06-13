import { Routes, Route } from 'react-router-dom'
import { LibraryHome } from './routes/LibraryHome.tsx'
import { ImportView } from './routes/ImportView.tsx'
import { GlobalWalkView } from './routes/GlobalWalkView.tsx'
import { PuzzleSessionView } from './routes/PuzzleSessionView.tsx'
import { CourseLayout } from './routes/CourseLayout.tsx'
import { ShortcutsOverlay } from './components/ShortcutsOverlay.tsx'

export function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<LibraryHome />} />
        <Route path="/import" element={<ImportView />} />
        <Route path="/pgn/:pgnId" element={<CourseLayout />} />
        <Route path="/pgn/:pgnId/line/:lineId" element={<CourseLayout />} />
        <Route path="/pgn/:pgnId/puzzles" element={<PuzzleSessionView />} />
        <Route path="/repasar-todo" element={<GlobalWalkView />} />
      </Routes>
      <ShortcutsOverlay />
    </>
  )
}
