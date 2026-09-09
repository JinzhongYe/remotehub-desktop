import type { ITheme } from 'xterm'

const terminalThemes: Record<'dark' | 'light', ITheme> = {
  dark: { background: '#0b0f14', foreground: '#d7dee7', cursor: '#79b8ff', black: '#111821', red: '#ff7b86', green: '#57d6a5', yellow: '#e5bd68', blue: '#79b8ff', magenta: '#c4a7ff', cyan: '#70cfff', white: '#c8d2dc', brightBlack: '#778493', brightRed: '#ff9aa2', brightGreen: '#7be6bd', brightYellow: '#f2d68d', brightBlue: '#a1ccff', brightMagenta: '#d7c4ff', brightCyan: '#9be2ff', brightWhite: '#f4f7fa', selectionBackground: '#25476b', selectionForeground: '#ffffff', selectionInactiveBackground: '#24303d' },
  light: { background: '#ffffff', foreground: '#17202a', cursor: '#1769aa', black: '#111827', red: '#b42335', green: '#047857', yellow: '#8a5b00', blue: '#1769aa', magenta: '#6d28d9', cyan: '#036980', white: '#d6dde5', brightBlack: '#52606d', brightRed: '#d13b4b', brightGreen: '#16845f', brightYellow: '#9b6700', brightBlue: '#287ab8', brightMagenta: '#7c3aed', brightCyan: '#087f95', brightWhite: '#f4f6f8', selectionBackground: '#c7e1f5', selectionForeground: '#111827', selectionInactiveBackground: '#e0eaf2' }
}

export function terminalTheme(): ITheme {
  return terminalThemes[document.documentElement.dataset.theme === 'light' ? 'light' : 'dark']
}
