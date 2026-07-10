import { deepEqual, equal, strictEqual } from 'node:assert/strict'
import { test } from 'node:test'
import { Clock, Merkle, Timestamp } from './index.ts'

const nodeID = 'e35dd11177e4cc2c'

test('Timestamp.toString & Timestamp.fromString', () => {
  const ts = new Timestamp(123, 42, nodeID)
  const str = `1970-01-01T00:00:00.123Z-002A-${ts.nodeID}`
  strictEqual(ts.toJSON(), str)
  deepEqual(Timestamp.fromJSON(str), ts)
})

test('Merkle.hash', () => {
  const tree = new Merkle()
  tree.insert(new Timestamp(123, 42, nodeID))
  // @ts-expect-error: testing private members here
  strictEqual(tree.hash, 1817861100)

  tree.insert(new Timestamp(456, 0, nodeID))
  // @ts-expect-error: testing private members here
  strictEqual(tree.hash, 1253944810)
})

test('Merkle.diff', () => {
  const ts1 = new Timestamp(1599729700000, 42, nodeID)
  const ts2 = new Timestamp(1599729800000, 0, nodeID)
  const ts3 = new Timestamp(1599729900000, 0, nodeID)

  const tree1 = new Merkle()
  tree1.insert(ts1)
  tree1.insert(ts2)
  tree1.insert(ts3)

  const tree2 = new Merkle()
  tree2.insert(ts1)
  tree2.insert(ts2)

  strictEqual(tree2.diff(tree1), ts3.millis)
  strictEqual(tree1.diff(tree2), ts3.millis)
})

test('Merkle.diff with empty Merkle', () => {
  const tree = new Merkle()
  tree.insert(new Timestamp(1599729700000, 42, nodeID))
  strictEqual(tree.diff(new Merkle()), 1599729660000)
})

test('Merkle.diff two empty Merkles', () => {
  equal(new Merkle().diff(new Merkle()), undefined)
})

test('Merkle.clone', () => {
  const tree1 = new Merkle()
  tree1.insert(new Timestamp(123, 42, nodeID))
  // @ts-expect-error: testing private members here
  strictEqual(tree1.hash, 1817861100)

  const tree2 = tree1.clone()
  tree2.insert(new Timestamp(456, 0, nodeID))
  // @ts-expect-error: testing private members here
  strictEqual(tree2.hash, 1253944810)

  // @ts-expect-error: testing private members here
  strictEqual(tree1.hash, 1817861100)
})

test('Clock.fromJSON', () => {
  const c = new Clock()
  const json = JSON.parse(JSON.stringify(c))
  const out = Clock.fromJSON(json)
  deepEqual(c, out)
})
