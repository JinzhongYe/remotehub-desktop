import { describe, expect, it } from 'vitest'
import { confirmDialog, confirmState, settleConfirm } from '../src/renderer/dialog'

describe('confirmation dialog', () => {
  it('opens with the requested copy and resolves the user choice', async () => {
    const choice = confirmDialog({ title: 'Quit?', message: 'Connections will close.', confirmText: 'Quit', danger: true })
    expect(confirmState).toMatchObject({ open: true, title: 'Quit?', danger: true })
    settleConfirm(true)
    await expect(choice).resolves.toBe(true)
    expect(confirmState.open).toBe(false)
  })
})
