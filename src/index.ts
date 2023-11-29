import { customAlphabet } from 'nanoid'

import { murmurHashV3 } from './murmurhash.js'

const nanoid = customAlphabet('1234567890abcdefghijklmnopqrstuvwxyz', 16)
const kLastSync = 'last_sync'
const kClock = 'clock'

class ClockDriftError extends Error {
  type = 'ClockDriftError'
  constructor(context: string) {
    super()
    this.message = `clock drift exceeded limit: ${context}`
  }
}

class CounterOverflowError extends Error {
  type = 'CounterOverflowError'
  constructor() {
    super()
    this.message = 'timestamp counter overflow'
  }
}

class InvalidTimestampError extends Error {
  type = 'InvalidTimestampError'
  constructor(input: string) {
    super()
    this.message = `timestamp format invalid: ${input}`
  }
}

// Timestamp for Hybrid Logical Clocks.
export class Timestamp {
  constructor(
    public readonly millis: number,
    public readonly counter: number,
    public readonly nodeID: string,
  ) {}

  // Serialize this Timestamp to a string. The strings are lexically sortable.
  toJSON(): string {
    return [
      new Date(this.millis).toISOString(),
      ('0000' + this.counter.toString(16).toUpperCase()).slice(-4),
      ('0000000000000000' + this.nodeID).slice(-16),
    ].join('-')
  }

  // Parse serialized string to structured Timestamp.
  public static fromJSON(input: string): Timestamp {
    const parts = input.split('-', 5)
    if (!parts || parts.length !== 5) {
      throw new InvalidTimestampError(input)
    }
    const millis = Date.parse(parts.slice(0, 3).join('-')).valueOf()
    const counter = parseInt(parts[3], 16)
    const nodeID = parts[4]
    if (isNaN(millis) || isNaN(counter)) {
      throw new InvalidTimestampError(input)
    }
    return new Timestamp(millis, counter, nodeID)
  }

  // Return a hash for this Timestamp.
  public hash(): number {
    return murmurHashV3(this.toJSON())
  }

  // Return the associated time rounded to the nearest minute.
  public minute(): number {
    return (this.millis / 1000 / 60) | 0
  }
}

function minuteKeyToMS(key: string): number {
  // 16 is the length of the base 3 value of the current time in
  // minutes. Ensure it's padded to create the full value
  const fullkey = key + '0'.repeat(16 - key.length)

  // Parse the base 3 representation
  return parseInt(fullkey, 3) * 1000 * 60
}

interface MerkleChildren {
  [key: string]: Merkle
}

// Merkle Tree to track Timestamps. It rounds them to the nearest minute. The
// downstream implication of that rounding is that we may overfetch messages
// within the timespan of a minute. It does not affect accuracy, and the benefit
// is that it reduces the size of the tree.
export class Merkle {
  constructor(
    private hash: number = 0,
    private children: MerkleChildren = {},
  ) {}

  // eslint-disable-next-line
  public static fromJSON(data: any): Merkle {
    const children: MerkleChildren = {}
    Object.keys(data.children).forEach(
      k => (children[k] = Merkle.fromJSON(data.children[k])),
    )
    return new Merkle(data.hash, children)
  }

  // Clone the Merkle.
  public clone(): Merkle {
    const children: MerkleChildren = {}
    Object.keys(this.children).forEach(
      k => (children[k] = this.children[k].clone()),
    )
    return new Merkle(this.hash, children)
  }

  private get childKeys(): string[] {
    return Object.keys(this.children)
  }

  // Insert a Timestamp into the Tree.
  public insert(ts: Timestamp): void {
    const tsHash = ts.hash()
    const key = ts.minute().toString(3)
    this.hash ^= tsHash
    this.insertKey(key, tsHash)
  }

  private insertKey(key: string, hash: number): void {
    if (key === '') {
      return
    }
    const c = key[0]
    let n = this.children[c]
    if (!n) {
      n = this.children[c] = new Merkle()
    }
    n.insertKey(key.slice(1), hash)
    n.hash ^= hash
  }

  // Diff the other tree and find the associated timestamp to the nearest minute
  // at which they differ. It returns undefined when the two trees are
  // identical.
  public diff(other: Merkle): number | undefined {
    if (this.hash === other.hash) {
      return
    }

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let node1: Merkle = this
    let node2: Merkle = other
    let k = ''

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const keyset = new Set([...node1.childKeys, ...node2.childKeys])
      const keys = [...keyset.values()]
      keys.sort()

      const diffkey = keys.find(key => {
        const next1 = node1.children[key] || new Merkle()
        const next2 = node2.children[key] || new Merkle()
        return next1.hash !== next2.hash
      })

      if (!diffkey) {
        return minuteKeyToMS(k)
      }

      k += diffkey
      node1 = node1.children[diffkey] || new Merkle()
      node2 = node2.children[diffkey] || new Merkle()
    }
  }
}

// Local Clock used to maintain this node's state.
export class Clock {
  public timestamp: Timestamp
  public readonly merkle: Merkle
  private maxDriftMS: number

  constructor(timestamp?: Timestamp, merkle?: Merkle, maxDriftMS?: number) {
    this.timestamp = timestamp || new Timestamp(0, 0, nanoid())
    this.merkle = merkle || new Merkle()
    this.maxDriftMS = maxDriftMS || 60000
  }

  // eslint-disable-next-line
  static fromJSON(data: any): Clock {
    return new Clock(
      Timestamp.fromJSON(data.timestamp),
      Merkle.fromJSON(data.merkle),
      data.maxDriftMS,
    )
  }

  // Generate a Timestamp suitable for sending to another node.
  send(): Timestamp {
    // retrieve the local wall clock time
    const now = Date.now()

    // time never goes backwards, even if the wall clock does
    const newMillis = Math.max(this.timestamp.millis, now)
    // if time has not advanced, the counter gets advanced
    const newCounter =
      this.timestamp.millis === newMillis ? this.timestamp.counter + 1 : 0

    // TODO: what do we do here? we prefer not to abort. should we somehow
    // indicate a full sync is required? what is the result of just ignoring
    // this?
    if (newMillis - now > this.maxDriftMS) {
      throw new ClockDriftError('while generating send timestamp')
    }

    // since we encode this to 4 hex bytes in the serialized timestamp.
    if (newCounter > 65535) {
      throw new CounterOverflowError()
    }

    this.timestamp = new Timestamp(newMillis, newCounter, this.timestamp.nodeID)
    return this.timestamp
  }

  // Receive a Timestamp from another node, and update local Timestamp to
  // preserve uniqueness and monotonicity.
  recv(ts: Timestamp): void {
    // retrieve the local wall clock time
    const now = Date.now()

    // TODO: again, why is clock drift an issue? why can't we accept this?
    if (ts.millis - now > this.maxDriftMS) {
      throw new ClockDriftError(`while accepting ${ts.toJSON()}`)
    }

    // time never goes backwards, take the highest of the 3 clock values
    const newMillis = Math.max(this.timestamp.millis, ts.millis, now)

    let newCounter = 0
    if (newMillis === this.timestamp.millis && newMillis === ts.millis) {
      // all clocks were equal, take the max counter and increment it.
      newCounter = Math.max(this.timestamp.counter, ts.counter) + 1
    } else if (newMillis === this.timestamp.millis) {
      // local clock was higher and left unchanged, increment local counter.
      newCounter = this.timestamp.counter + 1
    } else if (newMillis === ts.millis) {
      // incoming clock was higher and left unchanged, increment incoming
      // counter.
      newCounter = ts.counter + 1
    }

    // TODO: again, why is clock drift an issue? why can't we accept this?
    if (newMillis - now > this.maxDriftMS) {
      throw new ClockDriftError(`while accepting ${ts.toJSON()}`)
    }

    // since we encode this to 4 hex bytes in the serialized timestamp.
    if (newCounter > 65535) {
      throw new CounterOverflowError()
    }

    this.timestamp = new Timestamp(newMillis, newCounter, this.timestamp.nodeID)
  }
}

export interface Message {
  timestamp: string
  dataset: string
  row: string
  column: string
  value: unknown
}

export interface SyncRequest {
  merkle: Merkle
  messages: Message[]
}

export interface Remote {
  sync(req: SyncRequest): Promise<SyncRequest>
}

// Local is the set of functions the local side of the Sync should implement.
export interface Local {
  // These messages should be applied to the DB.
  applyChanges(messages: Message[]): Promise<void>

  // Store the messages into the message log. This may be different than the set
  // of messages we will apply changes from. For example it may include outdated
  // messages we may be ignoring. The insertions are expected to be idempotent,
  // and the return array should indicate which messages were inserted, and
  // which were already found in the log.
  storeMessages(messages: Message[]): Promise<boolean[]>

  // Query messages from the message log where the timestamp is greater than or
  // equal to the given timestamp.
  queryMessages(since: string): Promise<Message[]>

  // For each message, return the corresponding latest message we have in the
  // message log for the matching (dataset, row, column).
  queryLatestMessages(messages: Message[]): Promise<(Message | undefined)[]>

  // Set associated metadata as key/value.
  set(key: string, value: string): Promise<void>

  // Get Query the last successful sync timestamp.
  get(key: string): Promise<string | undefined>
}

const after = (timeout: number) =>
  new Promise(resolve => setTimeout(resolve, timeout))

export class SyncDB {
  private nextSync?: Promise<void>
  #pending = new Set()

  private constructor(
    private clock: Clock,
    private remote: Remote,
    private local: Local,
  ) {}

  // Create a new instance of a SyncDB.
  public static async new(remote: Remote, local: Local): Promise<SyncDB> {
    const clockJSON = await local.get(kClock)
    let clock: Clock
    if (clockJSON) {
      clock = Clock.fromJSON(JSON.parse(clockJSON))
    } else {
      clock = new Clock()
      await local.set(kClock, JSON.stringify(clock))
    }
    return new SyncDB(clock, remote, local)
  }

  private async saveClock(): Promise<void> {
    await this.local.set(kClock, JSON.stringify(this.clock))
  }

  private async apply(messages: Message[]): Promise<void> {
    // ensure we're always working with sorted messages, ordering is important.
    messages.sort((m1, m2) => {
      if (m1.timestamp < m2.timestamp) {
        return 1
      } else if (m1.timestamp > m2.timestamp) {
        return -1
      }
      return 0
    })

    const latestMessages = await this.local.queryLatestMessages(messages)
    if (latestMessages.length !== messages.length) {
      throw new Error(
        'queryLatestMessages returned unexpected number of messages',
      )
    }

    const eligibleApply: Message[] = []
    messages.forEach((msg, index) => {
      const existing = latestMessages[index]
      if (!existing || existing.timestamp < msg.timestamp) {
        eligibleApply.push(msg)
      }
    })

    // first apply the changes, then store the messages & update merkle.
    // this ordering will ensure failures allow for retries.
    await this.local.applyChanges(eligibleApply)

    // store the messages, and update the merkle to include the new messages.
    const inserted = await this.local.storeMessages(messages)
    inserted.forEach((include, index) => {
      if (include) {
        this.clock.merkle.insert(Timestamp.fromJSON(messages[index].timestamp))
      }
    })
    await this.saveClock()
  }

  // Recieve data from a Remote. You may find this useful if in addition to sync
  // you get messages pushed to your application.
  public async recv(messages: Message[]): Promise<void> {
    if (messages.length === 0) {
      return
    }
    messages.forEach(m => this.clock.recv(Timestamp.fromJSON(m.timestamp)))
    await this.saveClock()
    await this.apply(messages)
  }

  private scheduleSync(timeoutMS = 50) {
    let p: Promise<void>
    p = this.nextSync = (async () => {
      await after(timeoutMS)
      // if while waiting nextSync was changed, and no longer this promise, it
      // means another one was scheduled after us. we'll let that one do the
      // work instead of us.
      if (p !== this.nextSync) {
        return
      }
      await this.sync()
    })()
    p.finally(() => this.#pending.delete(p))
    this.#pending.add(p)
  }

  // Sync data to-and-from the Remote.
  public async sync(since?: string): Promise<void> {
    // Capture this at the onset to later send() calls don't affect us.
    const lastSync = this.clock.send().toJSON()
    await this.saveClock()

    // either the given since, or the last sync, or zero
    if (!since) {
      since = await this.local.get(kLastSync)
      if (!since) {
        since = new Timestamp(0, 0, '0').toJSON() // the begining of time
      }
    }
    const toSend = await this.local.queryMessages(since)
    const syncResponse = await this.remote.sync({
      merkle: this.clock.merkle.clone(),
      messages: toSend,
    })
    await this.recv(syncResponse.messages)
    await this.local.set(kLastSync, lastSync)

    // if we still have diffferences, we may need another sync.
    const diffTime = syncResponse.merkle.diff(this.clock.merkle)
    if (diffTime) {
      return this.sync(new Timestamp(diffTime, 0, '0').toJSON())
    }
  }

  // Send messages to the Remote. This applies the messages locally immediately,
  // and schedules a Remote sync to happen after a delay.
  public async send(messages: Omit<Message, 'timestamp'>[]): Promise<void> {
    const withTS = messages as Message[]
    withTS.forEach(m => (m.timestamp = this.clock.send().toJSON()))
    await this.saveClock()
    await this.apply(withTS)
    this.scheduleSync()
  }

  // Wait for scheduled sync to settle.
  public async settle(): Promise<void> {
    let last = this.nextSync
    while (true) {
      await Promise.allSettled(this.#pending.values())
      // if no new sync was scheduled, or was scheduled and finished, we're done
      if (last === this.nextSync) {
        return
      }
      // else we wait again if anything is pending
      last = this.nextSync
    }
  }
}
