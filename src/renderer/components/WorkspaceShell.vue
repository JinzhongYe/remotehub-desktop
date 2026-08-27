<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
import type { Connection } from '../../shared/types'
import { useConnectionStore } from '../stores/connection'
import { useWorkspaceStore } from '../stores/workspace'
import TerminalPane from './TerminalPane.vue'
import SerialTerminalPane from './SerialTerminalPane.vue'
import SftpPane from './SftpPane.vue'
import { t } from '../i18n'

const DatabasePane = defineAsyncComponent(() => import('./DatabasePane.vue'))

defineProps<{ shortcutModifier: string }>()
const workspace = useWorkspaceStore()
const connections = useConnectionStore()

function iconFor(type: string): string {
  return type === 'terminal' ? '›_' : type === 'sftp' ? '⇄' : type === 'sql' ? 'SQL' : '□'
}

function connectionFor(connectionId?: string): Connection | null {
  return connections.connections.find((connection) => connection.id === connectionId) || null
}

function openActiveAgain(): void {
  const tab = workspace.activeTab
  if (tab?.connectionId && (tab.type === 'terminal' || tab.type === 'sftp' || tab.type === 'sql')) workspace.openConnection(tab.connectionId, tab.title, tab.type)
}
</script>

<template>
  <section class="workspace-shell">
    <div class="tab-bar">
      <button v-for="tab in workspace.tabs" :key="tab.id" class="workspace-tab" :class="{ active: workspace.activeId === tab.id }" @click="workspace.activeId = tab.id">
        <span class="tab-icon">{{ iconFor(tab.type) }}</span><span>{{ tab.title }}</span><button v-if="tab.closable" class="tab-close" @click.stop="workspace.close(tab.id)">×</button>
      </button>
      <button class="new-tab" :title="t('newTab')" :disabled="!workspace.activeTab?.connectionId" @click="openActiveAgain">＋</button>
    </div>
    <div class="workspace-content">
      <div v-show="workspace.activeId === 'welcome'" class="welcome-view">
        <div class="welcome-glyph">RH</div>
        <h1>RemoteHub</h1>
        <p>{{ t('tagline') }}</p>
        <div class="shortcut-grid">
          <div><kbd>{{ shortcutModifier }} K</kbd><span>{{ t('searchShortcut') }}</span></div>
          <div><kbd>{{ shortcutModifier }} N</kbd><span>{{ t('addShortcut') }}</span></div>
          <div><kbd>{{ t('doubleClick') }}</kbd><span>{{ t('openWorkspace') }}</span></div>
        </div>
        <div class="phase-note"><span class="status-dot"></span><span>{{ t('phaseReady') }}</span></div>
      </div>
      <template v-for="tab in workspace.tabs" :key="tab.id">
        <TerminalPane v-if="tab.type === 'terminal' && connectionFor(tab.connectionId)?.type === 'ssh'" v-show="workspace.activeId === tab.id" :connection-id="tab.connectionId!" :active="workspace.activeId === tab.id" />
        <SerialTerminalPane v-else-if="tab.type === 'terminal' && connectionFor(tab.connectionId)?.type === 'serial'" v-show="workspace.activeId === tab.id" :connection-id="tab.connectionId!" :active="workspace.activeId === tab.id" />
        <SftpPane v-else-if="tab.type === 'sftp' && connectionFor(tab.connectionId)?.type === 'ssh'" v-show="workspace.activeId === tab.id" :connection-id="tab.connectionId!" />
        <DatabasePane v-else-if="tab.type === 'sql' && connectionFor(tab.connectionId)?.type === 'database'" v-show="workspace.activeId === tab.id" :connection-id="tab.connectionId!" />
        <div v-else-if="tab.connectionId" v-show="workspace.activeId === tab.id" class="workspace-placeholder">
          <div class="connection-overview">
            <div class="overview-icon">{{ connectionFor(tab.connectionId)?.type === 'database' ? 'DB' : '›_' }}</div>
            <span class="status-dot"></span>
            <div><span class="eyebrow">{{ t('workspaceReady') }}</span><h2>{{ connectionFor(tab.connectionId)?.name }}</h2><p>{{ connectionFor(tab.connectionId)?.host }}:{{ connectionFor(tab.connectionId)?.port }} · {{ connectionFor(tab.connectionId)?.type === 'database' ? connectionFor(tab.connectionId)?.databaseType : 'SSH' }}</p></div>
          </div>
          <div class="module-placeholders">
            <button class="module-tile" disabled><span>›_</span><strong>Terminal</strong><small>{{ t('terminalPhase') }}</small></button>
            <button class="module-tile" disabled><span>⇄</span><strong>SFTP</strong><small>{{ t('sftpPhase') }}</small></button>
            <button class="module-tile" disabled><span>SQL</span><strong>Database</strong><small>{{ t('databasePhase') }}</small></button>
          </div>
        </div>
      </template>
    </div>
  </section>
</template>
