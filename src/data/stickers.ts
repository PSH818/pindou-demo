/** Original cell-based decorations. Dots are empty cells, digits are color slots. */
export interface Sticker {
  id: string
  name: string
  rows: string[]
  colors: [number, number, number][]
}

export const STICKERS: Sticker[] = [
  { id: 'heart', name: '爱心', colors: [[242, 99, 128]], rows: [
    '.00.00.', '0000000', '0000000', '.00000.', '..000..', '...0...',
  ] },
  { id: 'star', name: '星星', colors: [[255, 204, 57]], rows: [
    '....0....', '...000...', '...000...', '000000000', '.0000000.',
    '..00000..', '..00000..', '.000.000.', '.00...00.',
  ] },
  { id: 'flower', name: '小花', colors: [[249, 166, 195], [255, 204, 57]], rows: [
    '...000...', '..00000..', '.0000000.', '000111000', '000111000',
    '000111000', '.0000000.', '..00000..', '...000...',
  ] },
  { id: 'bow', name: '蝴蝶结', colors: [[242, 99, 128], [190, 58, 102]], rows: [
    '00.....00', '000...000', '000010000', '000111000', '000010000',
    '00.010.00', '..00.00..', '..00.00..',
  ] },
]
