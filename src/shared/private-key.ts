export function isPrivateKeyText(value: string): boolean {
  const text = value.trimStart()
  return /^-----BEGIN (?:(?:OPENSSH|RSA|DSA|EC|ENCRYPTED) )?PRIVATE KEY-----/.test(text)
    || /^PuTTY-User-Key-File-[23]:/.test(text)
}

export function privateKeyFileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) || path
}
