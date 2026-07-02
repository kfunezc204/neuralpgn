import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface KebabMenuItem {
  label: string
  onClick: () => void
  danger?: boolean
}

interface KebabMenuProps {
  items: KebabMenuItem[]
  ariaLabel: string
}

interface MenuPosition {
  top: number
  left: number
}

const MENU_WIDTH = 160 // matches min-w-[10rem]
const MENU_GAP = 4

export function KebabMenu({ items, ariaLabel }: KebabMenuProps) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<MenuPosition | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onDocMouseDown(e: MouseEvent) {
      const target = e.target as Node
      if (rootRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Compute fixed-positioned coordinates anchored to the trigger button.
  // Portal-rendered menu escapes overflow:hidden ancestors (the chapter
  // accordion grid clips inline-positioned popovers).
  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const button = buttonRef.current
    if (!button) return
    const rect = button.getBoundingClientRect()
    const menuHeight = menuRef.current?.offsetHeight ?? items.length * 32 + 8
    const spaceBelow = window.innerHeight - rect.bottom
    const spaceAbove = rect.top
    const flipUp = spaceBelow < menuHeight + MENU_GAP && spaceAbove > spaceBelow
    const top = flipUp
      ? rect.top - menuHeight - MENU_GAP
      : rect.bottom + MENU_GAP
    const left = Math.max(8, rect.right - MENU_WIDTH)
    setPos({ top, left })
  }, [open, items.length])

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          e.preventDefault()
          setOpen((o) => !o)
        }}
        className="flex h-6 w-6 items-center justify-center rounded text-ink-muted transition-colors duration-150 hover:bg-surface-3 hover:text-ink"
      >
        ⋯
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ top: pos.top, left: pos.left, width: MENU_WIDTH }}
            className="fixed z-[1000] overflow-hidden rounded-md border border-line bg-surface-2 py-1 shadow-lg"
          >
            {items.map((it, i) => (
              <button
                key={i}
                type="button"
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  setOpen(false)
                  it.onClick()
                }}
                className={`flex w-full items-center px-3 py-1.5 text-left text-sm transition-colors duration-150 hover:bg-surface-3 ${
                  it.danger
                    ? 'text-danger hover:bg-danger-soft'
                    : 'text-ink-muted'
                }`}
              >
                {it.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  )
}
