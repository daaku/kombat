/* eslint-disable no-fallthrough */
// Author: Gary Court <gary.court@gmail.com>
// https://github.com/garycourt/murmurhash-js
export function murmurHashV3(key: string | Uint8Array, seed = 0): number {
  if (typeof key === 'string') {
    key = new TextEncoder().encode(key)
  }

  let h1, h1b, k1, i

  const c1 = 0xcc9e2d51
  const c2 = 0x1b873593
  const remainder = key.length & 3 // key.length % 4
  const bytes = key.length - remainder
  h1 = seed
  i = 0

  while (i < bytes) {
    k1 =
      (key[i] & 0xff) |
      ((key[++i] & 0xff) << 8) |
      ((key[++i] & 0xff) << 16) |
      ((key[++i] & 0xff) << 24)
    ++i

    k1 =
      ((k1 & 0xffff) * c1 + ((((k1 >>> 16) * c1) & 0xffff) << 16)) & 0xffffffff
    k1 = (k1 << 15) | (k1 >>> 17)
    k1 =
      ((k1 & 0xffff) * c2 + ((((k1 >>> 16) * c2) & 0xffff) << 16)) & 0xffffffff

    h1 ^= k1
    h1 = (h1 << 13) | (h1 >>> 19)
    h1b =
      ((h1 & 0xffff) * 5 + ((((h1 >>> 16) * 5) & 0xffff) << 16)) & 0xffffffff
    h1 = (h1b & 0xffff) + 0x6b64 + ((((h1b >>> 16) + 0xe654) & 0xffff) << 16)
  }

  k1 = 0

  switch (remainder) {
    // @ts-ignore we want fallthru
    case 3:
      k1 ^= (key[i + 2] & 0xff) << 16
    // @ts-ignore we want fallthru
    case 2:
      k1 ^= (key[i + 1] & 0xff) << 8
    case 1:
      k1 ^= key[i] & 0xff

      k1 =
        ((k1 & 0xffff) * c1 + ((((k1 >>> 16) * c1) & 0xffff) << 16)) &
        0xffffffff
      k1 = (k1 << 15) | (k1 >>> 17)
      k1 =
        ((k1 & 0xffff) * c2 + ((((k1 >>> 16) * c2) & 0xffff) << 16)) &
        0xffffffff
      h1 ^= k1
  }

  h1 ^= key.length

  h1 ^= h1 >>> 16
  h1 =
    ((h1 & 0xffff) * 0x85ebca6b +
      ((((h1 >>> 16) * 0x85ebca6b) & 0xffff) << 16)) &
    0xffffffff
  h1 ^= h1 >>> 13
  h1 =
    ((h1 & 0xffff) * 0xc2b2ae35 +
      ((((h1 >>> 16) * 0xc2b2ae35) & 0xffff) << 16)) &
    0xffffffff
  h1 ^= h1 >>> 16

  return h1 >>> 0
}
