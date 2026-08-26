<script setup lang="ts">
import type { Connection } from '../../shared/types'
import { useWorkspaceStore } from '../stores/workspace'

defineProps<{ selected: Connection | null }>()
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
      <button class="new-tab" title="新建工作区标签">＋</button>
    </div>
    <div class="workspace-content">
      <template v-if="workspace.activeTab?.type === 'welcome'">
        <div class="welcome-view">
          <div class="welcome-glyph">RH</div>
          <h1>RemoteHub</h1>
          <p>连接资产、终端、文件和数据库的本地工作区。</p>
          <div class="shortcut-grid">
            <div><kbd>⌘ K</kbd><span>搜索连接</span></div>
            <div><kbd>⌘ N</kbd><span>新增连接</span></div>
            <div><kbd>双击</kbd><span>打开工作区</span></div>
          </div>
          <div class="phase-note"><span class="status-dot"></span><span>Phase 0 · 桌面骨架与安全 IPC 已就绪</span></div>
        </div>
      </template>
      <template v-else>
        <div class="connection-overview">
          <div class="overview-icon">{{ selected?.type === 'database' ? 'DB' : '›_' }}</div>
          <span class="status-dot"></span>
          <div><span class="eyebrow">WORKSPACE READY</span><h2>{{ selected?.name }}</h2><p>{{ selected?.host }}:{{ selected?.port }} · {{ selected?.type === 'database' ? selected.databaseType : 'SSH' }}</p></div>
        </div>
        <div class="module-placeholders">
          <button class="module-tile" disabled><span>›_</span><strong>Terminal</strong><small>Phase 2 接入 SSH Session</small></button>
          <button class="module-tile" disabled><span>⇄</span><strong>SFTP</strong><small>Phase 4 接入文件工作区</small></button>
          <button class="module-tile" disabled><span>SQL</span><strong>Database</strong><small>Phase 6–8 接入数据库 Adapter</small></button>
        </div>
      </template>
    </div>
  </section>
</template>
