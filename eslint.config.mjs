import tseslint from 'typescript-eslint'

export default [
  { ignores: ['dist/**', 'dist-electron/**', 'release/**', 'node_modules/**', 'npm-cache/**', 'electron-cache/**'] },
  ...tseslint.configs.recommended,
  { ignores: ['dist/**', 'dist-electron/**', '**/*.vue'] }
]
