import { DatabaseSync } from 'node:sqlite'
import type { SqlAdapter, SqlExecuteResult } from '../SqlAdapter.ts'

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

  async close(): Promise<void> {
    this.db.close()
  }
}

export function openInMemoryAdapter(): SqlAdapter {
  return new NodeSqliteInMemoryAdapter()
}
