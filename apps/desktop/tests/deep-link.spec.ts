import { describe, expect, it } from 'vitest'
import { parseDeepLinkSession, parseDeepLinkSessionArgv } from '../src/deep-link.ts'

const UUID = '130d8cfd-c615-4ab6-9c5e-662a2c5b444b'

describe('parseDeepLinkSession', () => {
  it('accepts a dashed UUID session target', () => {
    expect(parseDeepLinkSession(`dsh://open?session=session-${UUID}`)).toBe(`session-${UUID}`)
  })

  it('accepts a compact 32-hex session target and the trailing-slash host form', () => {
    const compact = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
    expect(parseDeepLinkSession(`dsh://open/?session=session-${compact}`)).toBe(`session-${compact}`)
  })

  it('accepts an orchestrator session target', () => {
    expect(parseDeepLinkSession('dsh://open?session=orchestrator-abcdef1234567890')).toBe('orchestrator-abcdef1234567890')
  })

  it('rejects plain focus links, other hosts or paths, missing params, and invalid id shapes', () => {
    const rejected = [
      'dsh://open',
      'dsh://open/',
      'dsh://other?session=session-' + UUID,
      'dsh://open/messages?session=session-' + UUID,
      'dsh://open?session=',
      'dsh://open?session=session-1',
      'dsh://open?session=session-130d8cfd-c615-4ab6-9c5e-662a2c5b444',
      'dsh://open?session=Session-' + UUID,
      'dsh://open?session=orchestrator-123',
      'dsh://open?session=orchestrator-abcdef1234567890g',
      'https://open?session=session-' + UUID,
      'not-a-url',
    ]
    for (const link of rejected) expect(parseDeepLinkSession(link)).toBeNull()
  })

  it('keeps the first session parameter when repeated', () => {
    expect(parseDeepLinkSession(`dsh://open?session=session-${UUID}&session=orchestrator-abcdef1234567890`)).toBe(`session-${UUID}`)
  })
})

describe('parseDeepLinkSessionArgv', () => {
  it('scans argv for the first dsh:// link with a valid target', () => {
    expect(parseDeepLinkSessionArgv(['desktop.exe', `dsh://open?session=session-${UUID}`])).toBe(`session-${UUID}`)
  })

  it('returns null when argv carries no valid dsh:// session link', () => {
    expect(parseDeepLinkSessionArgv(['desktop.exe', '--updated', 'dsh://open'])).toBeNull()
  })
})
