import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { SshPasswordOptions } from '../../shared/ssh'

export type SshPasswordPromptResult =
  | { status: 'submitted'; options: SshPasswordOptions }
  | { status: 'cancelled' | 'timeout' }

type PasswordRequest = {
  connectionId: string
  label: string
  protocol: 'ssh' | 'sftp'
  resolve: (result: SshPasswordPromptResult) => void
}

export const useSshPasswordStore = defineStore('ssh-password', () => {
  const activeRequest = ref<PasswordRequest | null>(null)
  const queue: PasswordRequest[] = []
  const pending = new Map<string, Promise<SshPasswordPromptResult>>()

  const activePrompt = computed(() => activeRequest.value && ({
    connectionId: activeRequest.value.connectionId,
    label: activeRequest.value.label,
    protocol: activeRequest.value.protocol
  }))

  function showNext(): void {
    if (!activeRequest.value) activeRequest.value = queue.shift() || null
  }

  function request(connectionId: string, label: string, protocol: 'ssh' | 'sftp'): Promise<SshPasswordPromptResult> {
    const existing = pending.get(connectionId)
    if (existing) return existing

    let resolveRequest!: (result: SshPasswordPromptResult) => void
    const promise = new Promise<SshPasswordPromptResult>((resolve) => { resolveRequest = resolve })
    pending.set(connectionId, promise)
    queue.push({ connectionId, label, protocol, resolve: resolveRequest })
    showNext()
    return promise
  }

  function finish(result: SshPasswordPromptResult): void {
    const current = activeRequest.value
    if (!current) return
    activeRequest.value = null
    pending.delete(current.connectionId)
    current.resolve(result)
    showNext()
  }

  function submit(options: SshPasswordOptions): void {
    finish({ status: 'submitted', options })
  }

  function cancel(): void {
    finish({ status: 'cancelled' })
  }

  function timeout(): void {
    finish({ status: 'timeout' })
  }

  return { activePrompt, request, submit, cancel, timeout }
})
