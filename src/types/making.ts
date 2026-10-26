/** Making marks are independent of the editable pattern and its undo history. */
export interface MakingProgress {
  version: 1
  patternId: string
  signature: string
  revision: number
  completedColorIds: number[]
  updatedAt: number
}

export interface BoardTile {
  index: number
  row: number
  column: number
  x: number
  y: number
  width: number
  height: number
}

export interface PrintOptions {
  mode: 'whole' | 'boards'
  columns: number
  rows: number
}
