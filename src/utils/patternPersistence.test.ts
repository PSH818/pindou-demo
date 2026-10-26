import test from 'node:test'
import assert from 'node:assert/strict'
import { PatternSaveSession, PatternConflictError, clonePattern, patternVersion } from './patternPersistence.ts'
import type { Pattern } from '../types/index.ts'
const p: Pattern = { id: 'p', name: '原图', width: 2, height: 1, brandId: 'mard', paletteUsed: [1, 2], grid: new Uint16Array([0, 1]), thumbnail: '', createdAt: 1, updatedAt: 1 }

test('图纸基线比较包含珠格与元数据；相同时间也识别变化，快照独立', () => {
  const snapshot = clonePattern(p)
  snapshot.grid[0] = 1
  assert.notEqual(patternVersion(snapshot), patternVersion(p))
  assert.notEqual(patternVersion({ ...p, name: '改名' }), patternVersion(p))
  assert.equal(p.grid[0], 0)
})
test('同页连续写入按提交顺序推进基线，不把后续修改误判为冲突', async () => {
  let stored = clonePattern(p)
  const session = new PatternSaveSession(p, async (next, expected) => {
    await new Promise(resolve => setTimeout(resolve, 2))
    assert.equal(patternVersion(expected), patternVersion(stored))
    stored = clonePattern(next)
  })
  const a = { ...p, name: '第一次' }, b = { ...p, name: '第二次' }
  await Promise.all([session.save(a), session.save(b)])
  assert.equal(stored.name, '第二次'); assert.equal(session.isDirty(b), false)
})
test('冲突后已排队的写入全部停止，失败不会推进保存基线', async () => {
  let writes = 0
  const session = new PatternSaveSession(p, async () => { writes++; throw new PatternConflictError() })
  const next = { ...p, name: '未保存' }
  const outcomes = await Promise.allSettled([session.save(next), session.save(next)])
  assert.ok(outcomes.every(r => r.status === 'rejected'))
  assert.equal(writes, 1); assert.equal(session.isDirty(next), true)
})
test('普通存储错误允许重试且使用原基线，不修改调用者对象', async () => {
  let writes = 0
  const session = new PatternSaveSession(p, async (_next, expected) => {
    assert.equal(patternVersion(expected), patternVersion(p))
    if (++writes === 1) throw new Error('空间不足')
  })
  const next = { ...p, name: '修改' }
  await assert.rejects(session.save(next), /空间不足/)
  await session.save(next)
  assert.equal(session.isDirty(next), false)
})
