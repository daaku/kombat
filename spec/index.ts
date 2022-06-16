import { Clock, Merkle, Timestamp } from '../src/index.js';

const nodeID = 'e35dd11177e4cc2c';

it('Timestamp.toString & Timestamp.fromString', () => {
  const ts = new Timestamp(123, 42, nodeID);
  const str = `1970-01-01T00:00:00.123Z-002A-${ts.nodeID}`;
  expect(ts.toJSON()).toBe(str);
  expect(Timestamp.fromJSON(str)).toEqual(ts);
});

it('Merkle.hash', () => {
  const tree = new Merkle();
  tree.insert(new Timestamp(123, 42, nodeID));
  // @ts-expect-error: testing private members here
  expect(tree.hash).toBe(1817861100);

  tree.insert(new Timestamp(456, 0, nodeID));
  // @ts-expect-error: testing private members here
  expect(tree.hash).toBe(1253944810);
});

it('Merkle.diff', () => {
  const ts1 = new Timestamp(1599729700000, 42, nodeID);
  const ts2 = new Timestamp(1599729800000, 0, nodeID);
  const ts3 = new Timestamp(1599729900000, 0, nodeID);

  const tree1 = new Merkle();
  tree1.insert(ts1);
  tree1.insert(ts2);
  tree1.insert(ts3);

  const tree2 = new Merkle();
  tree2.insert(ts1);
  tree2.insert(ts2);

  expect(tree2.diff(tree1)).toBe(ts3.millis);
  expect(tree1.diff(tree2)).toBe(ts3.millis);
});

it('Merkle.diff with empty Merkle', () => {
  const tree = new Merkle();
  tree.insert(new Timestamp(1599729700000, 42, nodeID));
  expect(tree.diff(new Merkle())).toBe(1599729660000);
});

it('Merkle.diff two empty Merkles', () => {
  expect(new Merkle().diff(new Merkle())).toBeUndefined();
});

it('Merkle.clone', () => {
  const tree1 = new Merkle();
  tree1.insert(new Timestamp(123, 42, nodeID));
  // @ts-expect-error: testing private members here
  expect(tree1.hash).toBe(1817861100);

  const tree2 = tree1.clone();
  tree2.insert(new Timestamp(456, 0, nodeID));
  // @ts-expect-error: testing private members here
  expect(tree2.hash).toBe(1253944810);

  // @ts-expect-error: testing private members here
  expect(tree1.hash).toBe(1817861100);
});

it('Clock.fromJSON', () => {
  const c = new Clock();
  const json = JSON.parse(JSON.stringify(c));
  const out = Clock.fromJSON(json);
  expect(c).toEqual(out);
});
