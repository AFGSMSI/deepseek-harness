import { describe, expect, it, vi } from 'vitest'
import { claimDesktopSingleInstance, type DesktopSingleInstanceApplication } from '../src/single-instance.ts'

type SecondInstanceListener = (event: unknown, argv?: readonly string[]) => void

describe('desktop single-instance ownership', () => {
  it('quits a second process without registering lifecycle work', () => {
    const quit = vi.fn()
    const on = vi.fn()
    const application = {
      requestSingleInstanceLock: () => false,
      quit,
      on,
    } satisfies DesktopSingleInstanceApplication

    expect(claimDesktopSingleInstance(application, vi.fn())).toBe(false)
    expect(quit).toHaveBeenCalledOnce()
    expect(on).not.toHaveBeenCalled()
  })

  it('routes a later launch to the primary process with an empty argv fallback', () => {
    let secondInstance: SecondInstanceListener | undefined
    const focus = vi.fn()
    const application = {
      requestSingleInstanceLock: () => true,
      quit: vi.fn(),
      on: vi.fn((_event: 'second-instance', listener: SecondInstanceListener) => { secondInstance = listener }),
    } satisfies DesktopSingleInstanceApplication

    expect(claimDesktopSingleInstance(application, focus)).toBe(true)
    secondInstance?.({})
    expect(focus).toHaveBeenCalledOnce()
    expect(focus).toHaveBeenCalledWith([])
  })

  it('forwards the later launch arguments to the owner', () => {
    let secondInstance: SecondInstanceListener | undefined
    const focus = vi.fn()
    const application = {
      requestSingleInstanceLock: () => true,
      quit: vi.fn(),
      on: vi.fn((_event: 'second-instance', listener: SecondInstanceListener) => { secondInstance = listener }),
    } satisfies DesktopSingleInstanceApplication
    const argv = ['desktop.exe', 'dsh://open?session=session-130d8cfd-c615-4ab6-9c5e-662a2c5b444b']

    expect(claimDesktopSingleInstance(application, focus)).toBe(true)
    secondInstance?.({}, argv)
    expect(focus).toHaveBeenCalledOnce()
    expect(focus).toHaveBeenCalledWith(argv)
  })
})
