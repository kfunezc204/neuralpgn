export interface SqlExecuteResult {
  lastInsertId?: number
  rowsAffected: number
}

export interface SqlStatement {
  sql: string
  params: unknown[]
}

export interface SqlAdapter {
  execute(sql: string, params?: unknown[]): Promise<SqlExecuteResult>
  select<T>(sql: string, params?: unknown[]): Promise<T[]>
  /**
   * Run every statement inside a single transaction: all applied, or none.
   * Callers that rewrite whole tables (backup restore) MUST use this instead
   * of sequential execute() calls, which have no rollback on failure.
   */
  executeAtomic(statements: SqlStatement[]): Promise<void>
  close(): Promise<void>
}
