/**
 * External `dsh://open?session=<id>` deep-link navigation for the Desktop shell.
 *
 * The main process drains a cold-start target through `take()` and pushes links
 * received while the application is running through `subscribe()`. The renderer
 * waits until both Workspace and Session snapshots are ready before opening the
 * target; an unknown or archived Session keeps the current selection and raises
 * the existing notice. Without the desktop bridge (Web builds, older Desktop) this
 * installs nothing.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RowToast } from './contract/slots.ts'

/** Optional deep-link bridge exposed by the Desktop preload. */
interface DeepLinkBridge {
  take(): Promise<string | undefined>
  subscribe(listener: (session: string) => void): () => void
}

/** @returns the desktop deep-link bridge, or undefined outside the Desktop shell. */
function readBridge(): DeepLinkBridge | undefined {
  const host = globalThis as typeof globalThis & { dshDesktop?: { deepLink?: DeepLinkBridge } }
  return host.dshDesktop?.deepLink
}

/**
 * Install deep-link navigation on the Workspace plugin lifetime.
 * @param ctx - Client root Context.
 * @param sessions - pure Session Controller.
 * @param workspaces - pure Workspace Controller.
 * @param openSession - navigate to an existing Session through the Workspace service.
 * @param notify - show one Workspace notice.
 */
export function installDeepLinkNavigation(
  ctx: Context,
  sessions: ISessions,
  workspaces: IWorkspaces,
  openSession: (sessionId: SessionId) => void,
  notify: (toast: RowToast) => void,
): void {
  const bridge = readBridge()
  if (bridge === undefined) return
  const lifetime = new AbortController()
  const queued: string[] = []

  const snapshotsReady = (): boolean =>
    workspaces.list.getSnapshot().phase === 'ready' && sessions.list.getSnapshot().phase === 'ready'

  const openTarget = (raw: string): void => {
    const sessionId = raw as SessionId
    const summary = sessions.list.getSnapshot().byId[sessionId]
    if (summary === undefined) {
      notify({ kind: 'deepLinkUnknown' })
      return
    }
    if (workspaces.list.getSnapshot().archivedSessionIds.includes(sessionId)) {
      notify({ kind: 'archivedNotOpenable' })
      return
    }
    openSession(sessionId)
  }

  /** Drain the latest queued target once snapshots are ready; an older pending link loses to a later one. */
  const drain = (): void => {
    if (lifetime.signal.aborted || !snapshotsReady()) return
    const target = queued.pop()
    if (target === undefined) return
    queued.length = 0
    openTarget(target)
  }

  const enqueue = (raw: string): void => {
    if (lifetime.signal.aborted) return
    queued.push(raw)
    drain()
  }

  ctx.effect(() => {
    const disposeSessions = sessions.list.subscribe(drain)
    const disposeWorkspaces = workspaces.list.subscribe(drain)
    const disposeBridge = bridge.subscribe(enqueue)
    void bridge.take().then((pending) => {
      if (pending !== undefined) enqueue(pending)
    }).catch(() => undefined)
    return () => {
      lifetime.abort()
      disposeSessions()
      disposeWorkspaces()
      disposeBridge()
    }
  }, 'ui-workspace: deep-link navigation')
}
