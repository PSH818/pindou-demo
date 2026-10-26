import { openDB } from 'idb'
import type { MakingProgress } from '../types/making'
import { assertMakingProgress } from './making'

const database = () => openDB('pindou-making', 1, { upgrade(db) { db.createObjectStore('progress', { keyPath: 'patternId' }) } })

export async function getMakingProgress(patternId: string): Promise<MakingProgress | null> {
  const db = await database()
  try {
    const value = await db.get('progress', patternId)
    if (value === undefined) return null
    assertMakingProgress(value)
    return value
  } finally { db.close() }
}

export async function saveMakingProgress(value: MakingProgress, expectedRevision: number): Promise<void> {
  assertMakingProgress(value)
  if (value.revision !== expectedRevision + 1) throw new Error('制作进度版本无效')
  const db = await database(), tx = db.transaction('progress', 'readwrite')
  const completed = tx.done.catch(e => e as Error)
  try {
    const previous = await tx.store.get(value.patternId) as MakingProgress | undefined
    if ((previous?.revision ?? 0) !== expectedRevision) throw new Error('进度已在其他页面更新，请重新读取后再操作')
    await tx.store.put(value)
    const failure = await completed
    if (failure) throw failure
  } catch (e) {
    try { tx.abort() } catch { /* transaction already finished */ }
    await completed
    throw e
  } finally { db.close() }
}
