// @vitest-environment jsdom
import { setImmediate } from 'node:timers/promises'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ISessions, SessionListState, SessionSummary,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type {
  IWorkspaces, WorkspaceSnapshot,
} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RowToast } from '../src/client/contract/slots.ts'
import { installDeepLinkNavigation } from '../src/client/deep-link.ts'

const sid = (id: string): SessionId => id as SessionId

const UUID = '130d8cfd-c615-4ab6-9c5e-662a2c5b444b'
const known = sid(`session-${UUID}`)
const unknown = sid('session-00000000-0000-4000-8000-000000000000')

const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  vi.restoreAllMocks()
  delete (window as { dshDesktop?: unknown }).dshDesktop
})

class Source<T> {
  private readonly listeners = new Set<() => void>()

  constructor(private value: T) {}

  getSnapshot(): T {
    return this.value
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  set(value: T): void {
    this.value = value
    for (const listener of [...this.listeners]) listener()
  }
}

function summary(id: SessionId): SessionSummary {
  return { id, displayTitle: String(id), running: false, blank: false, updatedAt: 0, retainedBy: {} }
}

function sessionState(items: readonly SessionSummary[], phase: SessionListState['phase'] = 'ready'): SessionListState {
  return {
    ids: items.map(item => item.id),
    byId: Object.fromEntries(items.map(item => [item.id, item])),
    phase,
    projectionsBySession: {},
  }
}

function workspaceState(archived: readonly SessionId[] = [], phase: WorkspaceSnapshot['phase'] = 'ready'): WorkspaceSnapshot {
  return { items: [], archivedSessionIds: archived, pinnedSessionIds: [], phase, state: 'idle', error: null }
}

interface DeepLinkBridgeStub {
  take: ReturnType<typeof vi.fn<() => Promise<string | undefined>>>
  subscribe: ReturnType<typeof vi.fn<(listener: (session: string) => void) => () => void>>
  emit: (session: string) => void
}

function stubBridge(pending?: string): DeepLinkBridgeStub {
  const listeners = new Set<(session: string) => void>()
  return {
    take: vi.fn(async () => pending),
    subscribe: vi.fn((listener) => { listeners.add(listener); return () => { listeners.delete(listener) } }),
    emit: (session) => { for (const listener of listeners) listener(session) },
  }
}

interface Bench {
  ctx: Context
  bridge: DeepLinkBridgeStub
  sessions: Source<SessionListState>
  workspaces: Source<WorkspaceSnapshot>
  openSession: ReturnType<typeof vi.fn<(sessionId: SessionId) => void>>
  notify: ReturnType<typeof vi.fn<(toast: RowToast) => void>>
}

function bench(options: { pending?: string; sessions?: SessionListState; workspaces?: WorkspaceSnapshot } = {}): Bench {
  const ctx = new Context()
  contexts.push(ctx)
  const bridge = stubBridge(options.pending)
  ;(window as { dshDesktop?: { deepLink: DeepLinkBridgeStub } }).dshDesktop = { deepLink: bridge }
  const sessions = new Source(options.sessions ?? sessionState([summary(known)]))
  const workspaces = new Source(options.workspaces ?? workspaceState())
  const openSession = vi.fn<(sessionId: SessionId) => void>()
  const notify = vi.fn<(toast: RowToast) => void>()
  installDeepLinkNavigation(
    ctx, { list: sessions } as unknown as ISessions, { list: workspaces } as unknown as IWorkspaces,
    openSession, notify,
  )
  return { ctx, bridge, sessions, workspaces, openSession, notify }
}

describe('installDeepLinkNavigation', () => {
  it('installs nothing without the desktop bridge', () => {
    const ctx = new Context()
    contexts.push(ctx)
    const sessions = new Source(sessionState([summary(known)]))
    const workspaces = new Source(workspaceState())
    const openSession = vi.fn()
    const notify = vi.fn()
    installDeepLinkNavigation(
      ctx, { list: sessions } as unknown as ISessions, { list: workspaces } as unknown as IWorkspaces,
      openSession, notify,
    )
    expect(openSession).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  })

  it('opens the cold-start target once snapshots are ready', async () => {
    const b = bench({ pending: String(known) })
    await setImmediate()
    expect(b.openSession).toHaveBeenCalledExactlyOnceWith(known)
    expect(b.notify).not.toHaveBeenCalled()
  })

  it('keeps the current session and warns on an unknown cold-start target', async () => {
    const b = bench({ pending: String(unknown) })
    await setImmediate()
    expect(b.notify).toHaveBeenCalledExactlyOnceWith({ kind: 'deepLinkUnknown' })
    expect(b.openSession).not.toHaveBeenCalled()
  })

  it('raises the archived notice instead of opening an archived cold-start target', async () => {
    const b = bench({ pending: String(known), workspaces: workspaceState([known]) })
    await setImmediate()
    expect(b.notify).toHaveBeenCalledExactlyOnceWith({ kind: 'archivedNotOpenable' })
    expect(b.openSession).not.toHaveBeenCalled()
  })

  it('waits for both startup baselines before draining the cold-start target', async () => {
    const b = bench({
      pending: String(known),
      sessions: sessionState([summary(known)], 'pending'),
      workspaces: workspaceState([], 'pending'),
    })
    await setImmediate()
    expect(b.openSession).not.toHaveBeenCalled()
    b.sessions.set(sessionState([summary(known)]))
    await setImmediate()
    expect(b.openSession).not.toHaveBeenCalled()
    b.workspaces.set(workspaceState())
    await setImmediate()
    expect(b.openSession).toHaveBeenCalledExactlyOnceWith(known)
  })

  it('opens a target delivered by a running instance through subscribe', () => {
    const b = bench()
    b.bridge.emit(String(known))
    expect(b.openSession).toHaveBeenCalledExactlyOnceWith(known)
    expect(b.notify).not.toHaveBeenCalled()
  })

  it('warns on a running-instance unknown target', () => {
    const b = bench()
    b.bridge.emit(String(unknown))
    expect(b.notify).toHaveBeenCalledExactlyOnceWith({ kind: 'deepLinkUnknown' })
    expect(b.openSession).not.toHaveBeenCalled()
  })

  it('lets a later queued target supersede an earlier one', async () => {
    const b = bench({
      sessions: sessionState([summary(known)], 'pending'),
      workspaces: workspaceState([], 'pending'),
    })
    b.bridge.emit(String(unknown))
    b.bridge.emit(String(known))
    await setImmediate()
    b.sessions.set(sessionState([summary(known)]))
    b.workspaces.set(workspaceState())
    await setImmediate()
    expect(b.openSession).toHaveBeenCalledExactlyOnceWith(known)
    expect(b.notify).not.toHaveBeenCalled()
  })
})
