export interface FsAdapter {
  readText(path: string): Promise<string | null>
  writeText(path: string, content: string): Promise<void>
  remove(path: string): Promise<void>
  listDir(dir: string): Promise<string[]>
}
