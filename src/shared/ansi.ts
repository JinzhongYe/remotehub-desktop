export function withoutAnsiBackgrounds(data: string): { output: string; remainder: string } {
  const incomplete = data.match(/\x1b(?:\[[0-9;:]*)?$/)
  const remainder = incomplete?.[0] || ''
  const complete = remainder ? data.slice(0, -remainder.length) : data
  const output = complete.replace(/\x1b\[([0-9;:]*)m/g, (sequence, parameters: string) => {
    if (!parameters) return sequence
    const codes = parameters.split(';')
    const kept: string[] = []
    for (let index = 0; index < codes.length; index++) {
      const code = Number(codes[index])
      if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107) || codes[index].startsWith('48:')) continue
      if (code === 48 && codes[index + 1] === '5') { index += 2; continue }
      if (code === 48 && codes[index + 1] === '2') { index += 4; continue }
      kept.push(codes[index])
    }
    return kept.length ? `\x1b[${kept.join(';')}m` : ''
  })
  return { output, remainder }
}
