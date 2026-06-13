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
      { keys: '?', description: 'Mostrar / ocultar este panel de atajos' },
      { keys: 'Esc', description: 'Cerrar diálogos y menús' },
    ],
  },
  {
    context: 'Tablero (repaso y replay)',
    shortcuts: [
      { keys: '← →', description: 'Jugada anterior / siguiente' },
      { keys: 'Inicio / Fin', description: 'Ir al inicio / final de la línea' },
      {
        keys: 'Enter o →',
        description: 'Siguiente variante (al completar una línea)',
      },
    ],
  },
  {
    context: 'Sidebar del curso',
    shortcuts: [
      { keys: 'Shift + clic', description: 'Seleccionar un rango de variantes' },
      { keys: 'Esc', description: 'Limpiar la selección múltiple' },
    ],
  },
  {
    context: 'Diálogos',
    shortcuts: [
      { keys: 'Enter', description: 'Confirmar (renombrar, crear perfil)' },
      { keys: 'Esc', description: 'Cancelar' },
    ],
  },
]
