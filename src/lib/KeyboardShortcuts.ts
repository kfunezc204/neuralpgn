// Central inventory of the app's keyboard shortcuts, grouped by context.
// The "?" overlay renders exactly this list — when adding a shortcut
// anywhere in the app, register it here so it stays discoverable.

export interface ShortcutEntry {
  keys: string
  description: string
}

export interface ShortcutGroup {
  context: string
  shortcuts: ShortcutEntry[]
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    context: 'General',
    shortcuts: [
      { keys: '?', description: 'Show / hide this shortcuts panel' },
      { keys: 'Esc', description: 'Close dialogs and menus' },
    ],
  },
  {
    context: 'Board (review and replay)',
    shortcuts: [
      { keys: '← →', description: 'Previous / next move' },
      {
        keys: 'Home / End',
        description: 'Jump to the start / end of the line',
      },
      {
        keys: 'Enter or →',
        description: 'Next line (after completing one)',
      },
    ],
  },
  {
    context: 'Course sidebar',
    shortcuts: [
      {
        keys: 'Shift + click',
        description: 'Select a range of lines',
      },
      { keys: 'Esc', description: 'Clear the multi-selection' },
    ],
  },
  {
    context: 'Dialogs',
    shortcuts: [
      { keys: 'Enter', description: 'Confirm (rename, create profile)' },
      { keys: 'Esc', description: 'Cancel' },
    ],
  },
]
