/** Strict parsing for external `dsh://open?session=<id>` deep links. */

/** `session-` plus a dashed 36-char UUID or a compact 32-char lowercase hex Session id. */
const SESSION_ID_PATTERN = /^session-(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})$/
/** Orchestrator Session id: `orchestrator-` followed by 8–64 lowercase hex characters. */
const ORCHESTRATOR_ID_PATTERN = /^orchestrator-[0-9a-f]{8,64}$/

/** @param value - candidate Session id carried by the link. */
function isWhitelistedSessionId(value: string): boolean {
  return SESSION_ID_PATTERN.test(value) || ORCHESTRATOR_ID_PATTERN.test(value)
}

/**
 * Parse one external deep link into its whitelisted Session target.
 *
 * Accepted links use the `dsh:` scheme, the `open` host, an empty or `/` path,
 * and a whitelisted `session` parameter (a repeated parameter keeps the first
 * value). Anything else — another host or path, a malformed or unknown id
 * shape — yields null so the application keeps its current view instead of
 * navigating to an invalid target.
 *
 * @param input - raw link from `open-url` or a launch argv entry.
 * @returns the whitelisted Session id, or null when the link carries no valid target.
 */
export function parseDeepLinkSession(input: string): string | null {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return null
  }
  if (url.protocol !== 'dsh:' || url.hostname !== 'open') return null
  if (url.pathname !== '' && url.pathname !== '/') return null
  const session = url.searchParams.get('session')
  if (session === null || !isWhitelistedSessionId(session)) return null
  return session
}

/**
 * Scan launch arguments for the first `dsh://open` link and parse its Session target.
 * @param argv - `process.argv` or the `second-instance` launch arguments.
 * @returns the whitelisted Session id, or null when no argument carries a valid target.
 */
export function parseDeepLinkSessionArgv(argv: readonly string[]): string | null {
  for (const arg of argv) {
    if (!arg.startsWith('dsh://')) continue
    const session = parseDeepLinkSession(arg)
    if (session !== null) return session
  }
  return null
}
