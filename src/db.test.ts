import { deepEqual, strictEqual } from 'node:assert/strict'
import { test } from 'node:test'
import { Clock, SyncDB, Timestamp } from './index.ts'
import type { Local, Message, Remote, SyncRequest } from './index.ts'

const nodeID = 'e35dd11177e4cc2c'

function sort(messages: Message[]) {
  messages.sort((m1, m2) => {
    if (m1.timestamp < m2.timestamp) {
      return -1
    } else if (m1.timestamp > m2.timestamp) {
      return 1
    }
    return 0
  })
}

function sc(syncDB: SyncDB): Clock {
  // @ts-expect-error accessing private data
  return syncDB.clock
}

class MemLocal implements Local {
  public messages: Message[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public db: any = {}
  public meta: { [key: string]: string } = {}

  async applyChanges(messages: Message[]): Promise<void> {
    messages.forEach(msg => {
      let dataset = this.db[msg.dataset]
      if (!dataset) {
        dataset = this.db[msg.dataset] = {}
      }
      const row = dataset[msg.row]
      if (!row) {
        dataset[msg.row] = { id: msg.row, [msg.column]: msg.value }
      } else {
        row[msg.column] = msg.value
      }
    })
  }

  async storeMessages(messages: Message[]): Promise<boolean[]> {
    const eligible: Message[] = []
    const results = messages.map(m => {
      const found = this.messages.some(e => m.timestamp === e.timestamp)
      if (!found) {
        eligible.push(m)
      }
      return !found
    })
    this.messages.push(...eligible)
    sort(this.messages)
    return results
  }

  async queryMessages(since: string): Promise<Message[]> {
    for (let i = 0; i < this.messages.length; i++) {
      if (this.messages[i].timestamp >= since) {
        return this.messages.slice(i)
      }
    }
    return []
  }

  async queryLatestMessages(
    messages: Message[],
  ): Promise<(Message | undefined)[]> {
    return messages.map(msg =>
      this.messages.findLast(
        existing =>
          msg.dataset === existing.dataset
          && msg.row === existing.row
          && msg.column === existing.column,
      )
    )
  }

  async set(key: string, value: string): Promise<void> {
    this.meta[key] = value
  }

  async get(key: string): Promise<string | undefined> {
    return this.meta[key]
  }
}

class LocalRemote implements Remote {
  public syncDB!: SyncDB
  public nodeID!: string
  public history: { in: SyncRequest; out: SyncRequest }[] = []

  async sync(req: SyncRequest): Promise<SyncRequest> {
    await this.syncDB.recv(req.messages)
    let toSend: Message[] = []
    const diffTime = req.merkle.diff(sc(this.syncDB).merkle)
    if (diffTime) {
      // @ts-expect-error accessing private data
      toSend = await this.syncDB.local.queryMessages(
        new Timestamp(diffTime, 0, '0').toJSON(),
      )
      // filter out messages from the requesting nodeID
      toSend = toSend.filter(m => !m.timestamp.endsWith(this.nodeID))
    }
    const out: SyncRequest = {
      merkle: sc(this.syncDB).merkle,
      messages: toSend,
    }
    this.history.push({ in: req, out: out })
    return out
  }
}

const yodaNameMessage = () => ({
  timestamp: new Timestamp(1599729700000, 0, nodeID).toJSON(),
  dataset: 'people',
  row: '123',
  column: 'name',
  value: 'yoda',
})

const yodaAge900Message = () => ({
  timestamp: new Timestamp(1599729800000, 0, nodeID).toJSON(),
  dataset: 'people',
  row: '123',
  column: 'age',
  value: 900,
})

const yodaAge950Message = () => ({
  timestamp: new Timestamp(1599729900000, 0, nodeID).toJSON(),
  dataset: 'people',
  row: '123',
  column: 'age',
  value: 950,
})

test('MemLocal.applyChanges', async () => {
  const local = new MemLocal()
  await local.applyChanges([yodaNameMessage(), yodaAge900Message()])
  deepEqual(local.db, {
    people: {
      '123': {
        id: '123',
        name: 'yoda',
        age: 900,
      },
    },
  })
})

test('MemLocal.storeMessages', async () => {
  const local = new MemLocal()
  const results1 = await local.storeMessages([
    yodaNameMessage(),
    yodaAge900Message(),
  ])
  deepEqual(results1, [true, true])
  const results2 = await local.storeMessages([
    yodaNameMessage(),
    yodaAge900Message(),
  ])
  deepEqual(results2, [false, false])
  deepEqual(local.messages, [yodaNameMessage(), yodaAge900Message()])
})

test('MemLocal.queryMessages', async () => {
  const local = new MemLocal()
  const originalIn = [
    yodaAge950Message(),
    yodaAge900Message(),
    yodaNameMessage(),
  ]
  await local.storeMessages(originalIn)
  deepEqual(await local.queryMessages(''), [
    yodaNameMessage(),
    yodaAge900Message(),
    yodaAge950Message(),
  ])
  deepEqual(await local.queryMessages(yodaAge900Message().timestamp), [
    yodaAge900Message(),
    yodaAge950Message(),
  ])
})

test('MemLocal.queryLatestMessages', async () => {
  const local = new MemLocal()
  const originalIn = [yodaNameMessage(), yodaAge900Message()]
  await local.storeMessages(originalIn)
  deepEqual(await local.queryLatestMessages(originalIn), originalIn)
  await local.storeMessages([yodaAge950Message()])
  deepEqual(await local.queryLatestMessages(originalIn), [
    yodaNameMessage(),
    yodaAge950Message(),
  ])
})

interface Side {
  local: MemLocal
  remote: LocalRemote
  syncDB: SyncDB
}

async function makePair(): Promise<[Side, Side]> {
  const localA = new MemLocal()
  const localB = new MemLocal()

  const remoteA = new LocalRemote()
  const remoteB = new LocalRemote()

  const syncDBA = await SyncDB.new(remoteA, localA)
  const syncDBB = await SyncDB.new(remoteB, localB)

  remoteA.syncDB = syncDBB
  remoteA.nodeID = sc(syncDBA).timestamp.nodeID

  remoteB.syncDB = syncDBA
  remoteB.nodeID = sc(syncDBB).timestamp.nodeID

  return [
    { local: localA, remote: remoteA, syncDB: syncDBA },
    { local: localB, remote: remoteB, syncDB: syncDBB },
  ]
}

async function makeTriple(): Promise<[MemLocal, Side, Side]> {
  const localA = new MemLocal()
  const localB = new MemLocal()
  const localServer = new MemLocal()

  const remoteA = new LocalRemote()
  const remoteB = new LocalRemote()
  const remoteServer = new LocalRemote()

  const syncDBA = await SyncDB.new(remoteA, localA)
  const syncDBB = await SyncDB.new(remoteB, localB)
  const syncDBServer = await SyncDB.new(remoteServer, localServer)

  remoteA.syncDB = syncDBServer
  remoteA.nodeID = sc(syncDBA).timestamp.nodeID

  remoteB.syncDB = syncDBServer
  remoteB.nodeID = sc(syncDBB).timestamp.nodeID

  remoteServer.nodeID = sc(syncDBServer).timestamp.nodeID

  return [
    localServer,
    { local: localA, remote: remoteA, syncDB: syncDBA },
    { local: localB, remote: remoteB, syncDB: syncDBB },
  ]
}

test('Sync Basic', async () => {
  const [sideA, sideB] = await makePair()
  await sideA.syncDB.send([yodaNameMessage(), yodaAge900Message()])
  // @ts-expect-error private member access
  sideA.syncDB.nextSync = null
  await sideA.syncDB.sync()
  deepEqual(sideA.local.db, {
    people: {
      '123': {
        id: '123',
        name: 'yoda',
        age: 900,
      },
    },
  })
  deepEqual(sideA.local.db, sideB.local.db)
  strictEqual(sideA.remote.history.length, 1)
  strictEqual(sideA.remote.history[0].in.messages.length, 2)
  strictEqual(sideA.remote.history[0].out.messages.length, 0)

  await sideB.syncDB.send([yodaAge950Message()])
  // @ts-expect-error private member access
  sideB.syncDB.nextSync = null
  await sideA.syncDB.sync()
  deepEqual(sideA.local.db, {
    people: {
      '123': {
        id: '123',
        name: 'yoda',
        age: 950,
      },
    },
  })
  deepEqual(sideA.local.db, sideB.local.db)
  strictEqual(sideA.remote.history.length, 2)
  strictEqual(sideA.remote.history[1].in.messages.length, 0)
  strictEqual(sideA.remote.history[1].out.messages.length, 1)
})

test('3 way Sync', async () => {
  const [server, sideA, sideB] = await makeTriple()

  // Side A sends some messages, but doesn't sync yet.
  await sideA.syncDB.send([yodaAge900Message()])
  // @ts-expect-error private member access
  sideA.syncDB.nextSync = null

  // Side B sends some messages, and syncs.
  await sideB.syncDB.send([yodaNameMessage(), yodaAge950Message()])
  // @ts-expect-error private member access
  sideB.syncDB.nextSync = null
  await sideB.syncDB.sync()
  deepEqual(sideB.local.db, {
    people: {
      '123': {
        id: '123',
        name: 'yoda',
        age: 950,
      },
    },
  })
  deepEqual(sideB.local.db, server.db)
  strictEqual(sideB.remote.history.length, 1)
  strictEqual(sideB.remote.history[0].in.messages.length, 2)
  strictEqual(sideB.remote.history[0].out.messages.length, 0)

  // Now Side A syncs, with it's older messages.
  // Server state should still be what it was and Side A should have caught up.
  await sideA.syncDB.sync()
  deepEqual(sideA.local.db, {
    people: {
      '123': {
        id: '123',
        name: 'yoda',
        age: 950,
      },
    },
  })
  deepEqual(sideA.local.db, server.db)
  strictEqual(sideA.remote.history.length, 1)
  strictEqual(sideA.remote.history[0].in.messages.length, 1)
  strictEqual(sideA.remote.history[0].out.messages.length, 2)

  // Side B sync should not change things.
  await sideB.syncDB.sync()
  deepEqual(sideB.local.db, {
    people: {
      '123': {
        id: '123',
        name: 'yoda',
        age: 950,
      },
    },
  })
  strictEqual(sideB.remote.history.length, 2)
  strictEqual(sideB.remote.history[1].in.messages.length, 0)
  strictEqual(sideB.remote.history[1].out.messages.length, 1)
})

const after = (timeout: number) =>
  new Promise(resolve => setTimeout(resolve, timeout))

test('settles with one scheduleSync', async () => {
  const [sideA, _] = await makePair()
  let sync = 0
  sideA.syncDB.sync = async () => {
    await after(10) // stiumation to prevent being immediate
    sync++
  }
  await sideA.syncDB.send([yodaAge900Message()])
  await sideA.syncDB.settle()
  strictEqual(sync, 1)
})

test('settles with two scheduleSync', async () => {
  const [sideA, _] = await makePair()
  let sync = 0
  sideA.syncDB.sync = async () => {
    await after(10) // stiumation to prevent being immediate
    sync++
  }
  await sideA.syncDB.send([yodaAge900Message()])
  await sideA.syncDB.send([yodaAge950Message()])
  await sideA.syncDB.settle()
  strictEqual(sync, 1)
})

test('settles with scheduleSync during a running scheduleSync', async () => {
  const [sideA, _] = await makePair()
  let sync = 0
  sideA.syncDB.sync = async () => {
    await after(10) // stiumation to prevent being immediate
    sideA.syncDB.sync = async () => {
      await after(10) // stiumation to prevent being immediate
      sync++
    }
    sync++
    await sideA.syncDB.send([yodaAge950Message()])
  }
  await sideA.syncDB.send([yodaAge900Message()])
  await sideA.syncDB.settle()
  strictEqual(sync, 2)
})
