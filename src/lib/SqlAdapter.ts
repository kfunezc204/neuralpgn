export interface SqlExecuteResult {
  lastInsertId?: number
  rowsAffected: number
}

export interface SqlAdapter {
  execute(sql: string, params?: unknown[]): Promise<SqlExecuteResult>
  select<T>(sql: string, params?: unknown[]): Promise<T[]>
  close(): Promise<void>
}
