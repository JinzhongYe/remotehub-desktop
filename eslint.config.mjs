import tseslint from 'typescript-eslint'

export default [
  ...tseslint.configs.recommended,
  { ignores: ['dist/**', 'dist-electron/**', '**/*.vue'] }
]
