export const MAX_INITIAL_COMMAND_LENGTH = 16_384
export const MAX_NOTES_LENGTH = 16_384
export const CONNECTION_COLORS = ['#ff4d4f', '#fa8c16', '#fadb14', '#52c41a', '#13c2c2', '#1677ff', '#a855f7', '#8c8c8c']

/** Preserve the user's input exactly, only translating existing newlines to terminal Enter. */
export function initialTerminalInput(command?: string, lineEnding = '\r'): string {
  return (command || '').replace(/\r\n|\r|\n/g, lineEnding)
}
