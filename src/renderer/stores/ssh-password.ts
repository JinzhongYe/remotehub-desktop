import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { SshPasswordOptions } from '../../shared/ssh'

export type SshPasswordPromptResult =
  | { status: 'submitted'; options: SshPasswordOptions }
  | { status: 'cancelled' | 'timeout' }

type PasswordRequest = {
  connectionId: string
  label: string
  resolve: (result: SshPasswordPromptResult) => void
}

const CACHE_DURATION_MS = 15_000

export const useSshPasswordStore = defineStore('ssh-password', () => {
  const activeRequest = ref<PasswordRequest | null>(null)
  const queue: PasswordRequest[] = []
  const pending = new Map<string, Promise<SshPasswordPromptResult>>()
  const recent = new Map<string, { expiresAt: number; result: SshPasswordPromptResult }>()

  const activePrompt = computed(() => activeRequest.value && ({
    connectionId: activeRequest.value.connectionId,
    label: activeRequest.value.label
  }))

  function showNext(): void {
    if (!activeRequest.value) activeRequest.value = queue.shift() || null
  }

  function request(connectionId: string, label: string): Promise<SshPasswordPromptResult> {
    const cached = recent.get(connectionId)
    if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.result)
    if (cached) recent.delete(connectionId)
    const existing = pending.get(connectionId)
    if (existing) return existing

    let resolveRequest!: (result: SshPasswordPromptResult) => void
    const promise = new Promise<SshPasswordPromptResult>((resolve) => { resolveRequest = resolve })
    pending.set(connectionId, promise)
    queue.push({ connectionId, label, resolve: resolveRequest })
    showNext()
    return promise
  }

  function finish(result: SshPasswordPromptResult): void {
    const current = activeRequest.value
    if (!current) return
    activeRequest.value = null
    pending.delete(current.connectionId)
    if (result.status === 'submitted') recent.set(current.connectionId, { expiresAt: Date.now() + CACHE_DURATION_MS, result })
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

  function forget(connectionId: string): void {
    recent.delete(connectionId)
  }

  return { activePrompt, request, submit, cancel, timeout, forget }
})
