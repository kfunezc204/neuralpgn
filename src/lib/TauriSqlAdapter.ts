import Database from '@tauri-apps/plugin-sql'
import { invoke } from '@tauri-apps/api/core'
import type {
  SqlAdapter,
  SqlExecuteResult,
  SqlStatement,
} from './SqlAdapter.ts'

function translateParams(sql: string): string {
  let n = 0
  return sql.replace(/\?/g, () => `$${++n}`)
}

export class TauriSqlAdapter implements SqlAdapter {
  private constructor(
    private readonly db: Database,
    /** Bare DB filename (e.g. "neuralpgn.<id>.db"), for sql_execute_atomic. */
    private readonly dbFilename: string,
  ) {}

  static async open(url: string): Promise<TauriSqlAdapter> {
    const db = await Database.load(url)
    const filename = url.startsWith('sqlite:')
      ? url.slice('sqlite:'.length)
      : url
    return new TauriSqlAdapter(db, filename)
  }

  async execute(
    sql: string,
    params: unknown[] = [],
  ): Promise<SqlExecuteResult> {
    const r = await this.db.execute(translateParams(sql), params)
    return { lastInsertId: r.lastInsertId, rowsAffected: r.rowsAffected }
  }

  async select<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.select<T[]>(translateParams(sql), params)
  }

  async executeAtomic(statements: SqlStatement[]): Promise<void> {
    // One Rust-side transaction over its own connection to the same DB file;
    // plugin-sql's pool cannot span BEGIN/COMMIT across execute() calls.
    await invoke('sql_execute_atomic', {
      db: this.dbFilename,
      statements: statements.map((s) => ({
        sql: translateParams(s.sql),
        params: s.params,
      })),
    })
  }

  async close(): Promise<void> {
    await this.db.close()
  }
}
