import { createRouter, createWebHashHistory } from 'vue-router'
import WorkspaceView from './views/WorkspaceView.vue'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [{ path: '/', name: 'workspace', component: WorkspaceView }]
})
