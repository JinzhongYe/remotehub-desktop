<script setup lang="ts">
import { defineAsyncComponent, onMounted, onUnmounted } from 'vue'
import type { Connection } from '../../shared/types'
import { useConnectionStore } from '../stores/connection'
import { useWorkspaceStore } from '../stores/workspace'
import TerminalPane from './TerminalPane.vue'
import SerialTerminalPane from './SerialTerminalPane.vue'
import SftpPane from './SftpPane.vue'
import { t } from '../i18n'

const DatabasePane = defineAsyncComponent(() => import('./DatabasePane.vue'))

const props = defineProps<{ shortcutModifier: string }>()
const workspace = useWorkspaceStore()
const connections = useConnectionStore()

onMounted(() => window.addEventListener('keydown', handleShortcut))
onUnmounted(() => window.removeEventListener('keydown', handleShortcut))

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

function closeMenu(event: MouseEvent): void {
  (event.currentTarget as HTMLElement).closest('details')?.removeAttribute('open')
}

function handleShortcut(event: KeyboardEvent): void {
  const modifier = props.shortcutModifier === '⌘' ? event.metaKey : event.ctrlKey
  if (!modifier) return
  const key = event.key.toLowerCase()
  if (/^[1-9]$/.test(key)) workspace.activate(workspace.tabs[Number(key) - 1]?.id || workspace.activeId)
  else if (event.key === 'Tab') workspace.cycle(event.shiftKey ? -1 : 1)
  else if (key === 'w') event.shiftKey ? workspace.closeAll() : workspace.close(workspace.activeId)
  else if (key === 't') openActiveAgain()
  else if (event.key === '\\') workspace.setViewCount(workspace.viewCount === 1 ? 2 : 1)
  else return
  event.preventDefault()
}
</script>

<template>
  <section class="workspace-shell">
    <div class="tab-bar">
      <div class="tab-strip" role="tablist">
        <div v-for="tab in workspace.tabs" :key="tab.id" class="workspace-tab" :class="{ active: workspace.activeId === tab.id, secondary: workspace.secondaryId === tab.id }" role="tab" :tabindex="workspace.activeId === tab.id ? 0 : -1" :aria-selected="workspace.activeId === tab.id" @click="workspace.activate(tab.id)" @keydown.enter="workspace.activate(tab.id)">
          <span class="tab-icon">{{ iconFor(tab.type) }}</span><span class="tab-title">{{ tab.title }}</span><span v-if="tab.pinned" class="tab-pin" :title="t('pinnedTab')">◆</span><button v-else-if="tab.closable" class="tab-close" :aria-label="t('closeTab')" @click.stop="workspace.close(tab.id)">×</button>
        </div>
        <button class="new-tab" :title="`${t('newTab')} (${shortcutModifier} T)`" :disabled="!workspace.activeTab?.connectionId" @click="openActiveAgain">＋</button>
      </div>
      <div class="tab-tools">
        <div class="view-switch" :aria-label="t('multiView')">
          <button :class="{ active: workspace.viewCount === 1 }" :title="t('singleView')" @click="workspace.setViewCount(1)">▣</button>
          <button :class="{ active: workspace.viewCount === 2 }" :title="t('doubleView')" :disabled="!workspace.canUseViewCount(2)" @click="workspace.setViewCount(2)">▥</button>
          <button :class="{ active: workspace.viewCount === 4 }" :title="t('quadView')" :disabled="!workspace.canUseViewCount(4)" @click="workspace.setViewCount(4)">▦</button>
        </div>
        <button :title="workspace.activeTab?.pinned ? t('unpinTab') : t('pinTab')" :disabled="!workspace.activeTab?.closable" @click="workspace.togglePinned()">{{ workspace.activeTab?.pinned ? '◆' : '◇' }}</button>
        <details class="tab-menu">
          <summary :aria-label="t('tabActions')">•••</summary>
          <div class="tab-menu-popover">
            <button :disabled="!workspace.activeTab?.closable" @click="workspace.closeOthers(); closeMenu($event)">{{ t('closeOthers') }}</button>
            <button :disabled="!workspace.activeTab?.closable" @click="workspace.closeRight(); closeMenu($event)">{{ t('closeRight') }}</button>
            <button @click="workspace.closeAll(); closeMenu($event)">{{ t('closeAll') }}</button>
          </div>
        </details>
      </div>
    </div>
    <div class="workspace-content" :class="`layout-${workspace.viewCount}`">
      <div v-show="workspace.activeId === 'welcome'" class="welcome-view workspace-pane-slot primary">
        <div class="welcome-glyph">RH</div>
        <h1>RemoteHub</h1>
        <p>{{ t('tagline') }}</p>
        <div class="shortcut-grid">
          <div><kbd>{{ shortcutModifier }} K</kbd><span>{{ t('searchShortcut') }}</span></div>
          <div><kbd>{{ shortcutModifier }} N</kbd><span>{{ t('addShortcut') }}</span></div>
          <div><kbd>{{ shortcutModifier }} Tab</kbd><span>{{ t('switchTabsShortcut') }}</span></div>
          <div><kbd>{{ shortcutModifier }} W</kbd><span>{{ t('closeTab') }}</span></div>
        </div>
        <div class="phase-note"><span class="status-dot"></span><span>{{ t('phaseReady') }}</span></div>
      </div>
      <template v-for="tab in workspace.tabs" :key="tab.id">
        <div v-if="tab.connectionId" v-show="workspace.isVisible(tab.id)" class="workspace-pane-slot" :class="{ primary: workspace.activeId === tab.id, secondary: workspace.secondaryIds.includes(tab.id) }">
          <div v-if="workspace.viewCount > 1" class="split-pane-heading"><span>{{ tab.title }}</span><small v-if="workspace.activeId === tab.id">{{ t('primaryView') }}</small><button v-else :aria-label="t('closeView')" @click="workspace.closePane(tab.id)">×</button></div>
          <div class="workspace-pane-body">
            <TerminalPane v-if="tab.type === 'terminal' && connectionFor(tab.connectionId)?.type === 'ssh'" :connection-id="tab.connectionId" :active="workspace.isVisible(tab.id)" />
            <SerialTerminalPane v-else-if="tab.type === 'terminal' && connectionFor(tab.connectionId)?.type === 'serial'" :connection-id="tab.connectionId" :active="workspace.isVisible(tab.id)" />
            <SftpPane v-else-if="tab.type === 'sftp' && connectionFor(tab.connectionId)?.type === 'ssh'" :connection-id="tab.connectionId" />
            <DatabasePane v-else-if="tab.type === 'sql' && connectionFor(tab.connectionId)?.type === 'database'" :connection-id="tab.connectionId" />
            <div v-else class="workspace-placeholder">
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
          </div>
        </div>
      </template>
    </div>
  </section>
</template>
