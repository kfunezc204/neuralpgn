// Loading silhouettes for the library cards and the course sidebar. Shown
// ONLY on first load — silent refreshes keep the previous content on screen.

function Bone({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded bg-surface-3 ${className}`}
    />
  )
}

export function CourseCardSkeleton() {
  return (
    <li
      aria-hidden="true"
      className="rounded-xl border border-line bg-surface-1 p-5"
    >
      <div className="flex items-start gap-4">
        <Bone className="h-16 w-16 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1">
          <Bone className="h-4 w-2/3" />
          <Bone className="mt-2 h-3 w-1/3" />
          <Bone className="mt-4 h-1.5 w-full rounded-full" />
          <div className="mt-4 flex justify-end gap-2">
            <Bone className="h-8 w-24 rounded-md" />
            <Bone className="h-8 w-24 rounded-md" />
          </div>
        </div>
      </div>
    </li>
  )
}

export function LibrarySkeleton() {
  return (
    <ul aria-label="Loading library" className="mt-8 space-y-3">
      <CourseCardSkeleton />
      <CourseCardSkeleton />
      <CourseCardSkeleton />
    </ul>
  )
}

export function SidebarSkeleton() {
  return (
    <div aria-label="Loading chapters" className="space-y-3 p-3">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-center gap-2">
          <Bone className="h-4 w-4 rounded-full" />
          <Bone className={`h-3.5 ${i % 3 === 0 ? 'w-3/4' : 'w-1/2'}`} />
        </div>
      ))}
    </div>
  )
}
