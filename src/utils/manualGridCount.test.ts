// @ts-nocheck — Node test runner.
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseManualGridCount } from './manualGridCount.ts'

test('只有空白表示自动检测，合法边界及前导零可解析', () => {
  for (const value of ['', ' ', '\t\n']) assert.equal(parseManualGridCount(value, '列数'), undefined)
  for (const [text, value] of [['1',1],['200',200],[' 10 ',10],['0010',10]]) assert.equal(parseManualGridCount(text,'行数'),value)
})
test('小数、科学计数法和残缺输入必须报错，不能截断或变为自动', () => {
  for (const value of ['10.9','10.0','1e2','1e','+10','-1','abc','0x10','1 0','１２']) {
    assert.throws(()=>parseManualGridCount(value,'列数'),/列数/)
  }
})
test('单轴也必须限制在 1–200 之间，超大数字不溢出', () => {
  for (const label of ['列数','行数']) for (const value of ['0','000','201','999999999999999999999']) {
    assert.throws(()=>parseManualGridCount(value,label),new RegExp(label))
  }
})
