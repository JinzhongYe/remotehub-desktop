import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import './styles/global.css'
import './styles/tokyo-night.css'

document.documentElement.dataset.platform = import.meta.env.TAURI_ENV_PLATFORM || ''
const visualViewport = window.visualViewport
function syncViewportHeight(): void {
  document.documentElement.style.setProperty('--app-height', `${Math.round(visualViewport?.height ?? window.innerHeight)}px`)
}
syncViewportHeight()
visualViewport?.addEventListener('resize', syncViewportHeight)
window.addEventListener('resize', syncViewportHeight)

createApp(App).use(createPinia()).use(router).mount('#app')
