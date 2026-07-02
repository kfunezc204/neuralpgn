import { DatabaseSync } from 'node:sqlite'
import type {
  SqlAdapter,
  SqlExecuteResult,
  SqlStatement,
} from '../SqlAdapter.ts'

class NodeSqliteInMemoryAdapter implements SqlAdapter {
  private readonly db: DatabaseSync

  constructor() {
    this.db = new DatabaseSync(':memory:')
    this.db.exec('PRAGMA foreign_keys = ON')
  }

  async execute(
    sql: string,
    params: unknown[] = [],
  ): Promise<SqlExecuteResult> {
    const stmt = this.db.prepare(sql)
    const info = stmt.run(...(params as never[]))
    return {
      lastInsertId: Number(info.lastInsertRowid),
      rowsAffected: Number(info.changes),
    }
  }

  async select<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const stmt = this.db.prepare(sql)
    return stmt.all(...(params as never[])) as T[]
  }

  async executeAtomic(statements: SqlStatement[]): Promise<void> {
    // Single connection, so BEGIN/COMMIT is a real transaction here — the
    // same all-or-nothing contract the Tauri adapter gets from the
    // sql_execute_atomic Rust command.
    this.db.exec('BEGIN')
    try {
      for (const st of statements) {
        this.db.prepare(st.sql).run(...(st.params as never[]))
      }
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  async close(): Promise<void> {
    this.db.close()
  }
}

export function openInMemoryAdapter(): SqlAdapter {
  return new NodeSqliteInMemoryAdapter()
}
