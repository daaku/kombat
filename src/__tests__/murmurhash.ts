import { murmurHashV3 } from '../murmurhash';

test.each([
  ['', 0, 0],
  ['', 1, 0x514e28b7],
  ['', 0xffffffff, 0x81f16f39],
  ['\0\0\0\0', 0, 0x2362f9de],
  ['aaaa', 0x9747b28c, 0x5a97808a],
  ['aaa', 0x9747b28c, 0x283e0130],
  ['aa', 0x9747b28c, 0x5d211726],
  ['a', 0x9747b28c, 0x7fa09ea6],
  ['abcd', 0x9747b28c, 0xf0478627],
  ['abc', 0x9747b28c, 0xc84a62dd],
  ['ab', 0x9747b28c, 0x74875592],
  ['a', 0x9747b28c, 0x7fa09ea6],
  ['Hello, world!', 0x9747b28c, 0x24884cba],
  ['a'.repeat(256), 0x9747b28c, 0x37405bdc],
  ['abc', 0, 0xb3dd93fa],
  ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', 0, 0xee925b90],
  ['The quick brown fox jumps over the lazy dog', 0x9747b28c, 0x2fa826cd],
  //TODO: need to use TextEncoder
  //['ππππππππ', 0x9747b28c, 0xd58063c1],
])('murmurHashV3(%s, %d) => %d', (key, seed, hash) => {
  expect(murmurHashV3(key, seed)).toBe(hash);
});
