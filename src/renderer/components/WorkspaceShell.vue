<script setup lang="ts">
import type { Connection } from '../../shared/types'
import { useWorkspaceStore } from '../stores/workspace'
import TerminalPane from './TerminalPane.vue'
import { t } from '../i18n'

defineProps<{ selected: Connection | null; shortcutModifier: string }>()
const workspace = useWorkspaceStore()

function iconFor(type: string): string {
  return type === 'terminal' ? '›_' : type === 'sftp' ? '⇄' : type === 'sql' ? 'SQL' : '□'
}
</script>

<template>
  <section class="workspace-shell">
    <div class="tab-bar">
      <button v-for="tab in workspace.tabs" :key="tab.id" class="workspace-tab" :class="{ active: workspace.activeId === tab.id }" @click="workspace.activeId = tab.id">
        <span class="tab-icon">{{ iconFor(tab.type) }}</span><span>{{ tab.title }}</span><button v-if="tab.closable" class="tab-close" @click.stop="workspace.close(tab.id)">×</button>
      </button>
      <button class="new-tab" :title="t('newTab')">＋</button>
    </div>
    <div class="workspace-content">
      <template v-if="workspace.activeTab?.type === 'welcome'">
        <div class="welcome-view">
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
      </template>
      <template v-else>
        <TerminalPane v-if="selected?.type === 'ssh' && workspace.activeTab?.type === 'terminal' && workspace.activeTab.connectionId === selected.id" :key="selected.id" :connection-id="selected.id" />
        <template v-else>
          <div class="connection-overview">
            <div class="overview-icon">{{ selected?.type === 'database' ? 'DB' : '›_' }}</div>
            <span class="status-dot"></span>
            <div><span class="eyebrow">{{ t('workspaceReady') }}</span><h2>{{ selected?.name }}</h2><p>{{ selected?.host }}:{{ selected?.port }} · {{ selected?.type === 'database' ? selected.databaseType : 'SSH' }}</p></div>
          </div>
          <div class="module-placeholders">
            <button class="module-tile" disabled><span>›_</span><strong>Terminal</strong><small>{{ t('terminalPhase') }}</small></button>
            <button class="module-tile" disabled><span>⇄</span><strong>SFTP</strong><small>{{ t('sftpPhase') }}</small></button>
            <button class="module-tile" disabled><span>SQL</span><strong>Database</strong><small>{{ t('databasePhase') }}</small></button>
          </div>
        </template>
      </template>
    </div>
  </section>
</template>
