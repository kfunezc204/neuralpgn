import Database from '@tauri-apps/plugin-sql'
import type { SqlAdapter, SqlExecuteResult } from './SqlAdapter.ts'

function translateParams(sql: string): string {
  let n = 0
  return sql.replace(/\?/g, () => `$${++n}`)
}

export class TauriSqlAdapter implements SqlAdapter {
  private constructor(private readonly db: Database) {}

  static async open(url: string): Promise<TauriSqlAdapter> {
    const db = await Database.load(url)
    return new TauriSqlAdapter(db)
  }

  async execute(sql: string, params: unknown[] = []): Promise<SqlExecuteResult> {
    const r = await this.db.execute(translateParams(sql), params)
    return { lastInsertId: r.lastInsertId, rowsAffected: r.rowsAffected }
  }

  async select<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.select<T[]>(translateParams(sql), params)
  }

  async close(): Promise<void> {
    await this.db.close()
  }
}
