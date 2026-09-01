import type { SftpEntryType } from '../shared/sftp'

export type FileVisual = { icon: string; tone: string; badge?: string }

const badgeRules: [RegExp, string, string, string?][] = [
  [/\.(php\d?|phtml|phar)$/i, 'php', 'php'],
  [/\.(tsx?|mts|cts)$/i, 'TS', 'typescript'],
  [/\.(jsx?|mjs|cjs)$/i, 'JS', 'javascript'],
  [/\.vue$/i, 'V', 'vue'],
  [/\.(py|pyw|pyi)$/i, 'PY', 'python'],
  [/\.html?$/i, '5', 'html'],
  [/\.(css|scss|sass|less)$/i, '3', 'css'],
  [/\.(json|jsonc)$/i, '{}', 'json'],
  [/\.ya?ml$/i, 'YML', 'yaml'],
  [/\.(md|mdx)$/i, 'MD', 'markdown'],
  [/\.(sh|bash|zsh|fish|ps1)$/i, '>_', 'shell'],
  [/\.java$/i, 'JV', 'java'],
  [/\.kts?$/i, 'KT', 'kotlin'],
  [/\.go$/i, 'GO', 'go'],
  [/\.rs$/i, 'RS', 'rust'],
  [/\.(c|h|cc|cpp|cxx|hpp)$/i, 'C++', 'cpp'],
  [/\.cs$/i, 'C#', 'csharp'],
  [/\.rb$/i, 'RB', 'ruby'],
  [/\.swift$/i, 'SW', 'swift'],
  [/\.dart$/i, 'DT', 'dart'],
  [/\.sql$/i, 'SQL', 'sql'],
  [/^dockerfile(\..*)?$/i, 'DK', 'docker'],
  [/\.svelte$/i, 'SV', 'svelte'],
  [/\.(docx?|odt|pages)$/i, 'W', 'word', 'fileText'],
  [/\.(xlsx?|xlsm|ods)$/i, 'X', 'excel', 'table'],
  [/\.(pptx?|odp|keynote)$/i, 'P', 'powerpoint', 'presentation'],
  [/\.(psd|psb)$/i, 'Ps', 'photoshop', 'image'],
  [/\.(ai|ait|eps)$/i, 'Ai', 'illustrator', 'image'],
  [/\.xd$/i, 'Xd', 'adobexd', 'image'],
  [/\.(fig|sketch)$/i, 'UI', 'design', 'image'],
  [/\.ipynb$/i, 'NB', 'notebook'],
  [/\.(wasm|wat)$/i, 'WA', 'wasm'],
  [/\.(graphql|gql)$/i, 'GQL', 'graphql'],
  [/\.(tf|tfvars)$/i, 'TF', 'terraform'],
  [/\.lua$/i, 'LUA', 'lua'],
  [/\.(pl|pm)$/i, 'PL', 'perl'],
  [/\.scala$/i, 'SC', 'scala'],
  [/\.(ex|exs)$/i, 'EX', 'elixir'],
  [/\.r$/i, 'R', 'r'],
  [/\.sol$/i, 'SOL', 'solidity']
]

const fileIconRules: [RegExp, string][] = [
  [/^(dockerfile|makefile|rakefile|gemfile)|\.(js|jsx|mjs|cjs|ts|tsx|vue|svelte|html?|css|scss|sass|less|py|rb|php|java|kt|kts|go|rs|c|cc|cpp|h|hpp|cs|swift|dart|sh|bash|zsh|fish|ps1|sql)$/i, 'code'],
  [/^\.(env|gitignore|gitattributes|npmrc|editorconfig|bashrc|zshrc|profile)|\.(json|jsonc|ya?ml|toml|xml|ini|conf|cfg|config|properties|lock|webmanifest)$/i, 'config'],
  [/^(readme|license|changelog|authors|notice)(\..*)?$|\.(txt|md|mdx|rtf|log|nfo|srt|vtt|ass|ssa)$/i, 'fileText'],
  [/\.pdf$/i, 'pdf'],
  [/\.(csv|tsv|parquet|orc|avro)$/i, 'table'],
  [/\.(png|jpe?g|gif|webp|svg|ico|bmp|tiff?|heic|avif|raw|cr2|nef|arw|dng)$/i, 'image'],
  [/\.(mp3|wav|flac|aac|ogg|opus|m4a|wma|aiff?|mid|midi|amr|m3u8?|pls)$/i, 'audio'],
  [/\.(mp4|mkv|mov|avi|webm|m4v|mpe?g|m2ts|flv|wmv|3gp)$/i, 'video'],
  [/\.(zip|rar|7z|tar|tar\.gz|tgz|gz|bz2|xz|zst|cab|lz|lzh|cpio|dmg|iso|pkg|deb|rpm|apk|ipa|jar|war|torrent)$/i, 'archive'],
  [/\.(db|sqlite3?|mdb|accdb|duckdb|sqlitedb)$/i, 'database'],
  [/^(id_rsa|id_ed25519|authorized_keys|known_hosts)$|\.(pem|key|pub|ppk|crt|cer|p12|pfx|jks|asc|gpg|sig)$/i, 'key'],
  [/\.(ttf|otf|woff2?|eot)$/i, 'font'],
  [/\.(exe|msi|bat|cmd|app|bin|run|appimage|com|elf|dll|so|dylib)$/i, 'executable'],
  [/\.(epub|mobi|azw3?|fb2)$/i, 'book'],
  [/\.(eml|msg|mbox)$/i, 'mail'],
  [/\.ics$/i, 'calendar'],
  [/\.(obj|fbx|blend|stl|3ds|gltf|glb|dwg|dxf|step|stp|iges|igs)$/i, 'cube'],
  [/\.(vmdk|vdi|qcow2?|vhdx?)$/i, 'drive']
]

function extensionBadge(name: string): string | undefined {
  const extension = name.match(/\.([^.]+)$/)?.[1]
  if (!extension || !/^[a-z0-9]+$/i.test(extension)) return undefined
  return extension.slice(0, 4).toUpperCase()
}

export function fileVisual(type: SftpEntryType, name = ''): FileVisual {
  if (type === 'directory') return { icon: 'folder', tone: 'folder' }
  if (type === 'link') return { icon: 'link', tone: 'link' }
  const badge = badgeRules.find(([pattern]) => pattern.test(name))
  if (badge) return { icon: badge[3] || 'code', badge: badge[1], tone: `language-${badge[2]}` }
  const icon = fileIconRules.find(([pattern]) => pattern.test(name))?.[1] || 'file'
  const extension = icon === 'file' ? extensionBadge(name) : undefined
  return extension ? { icon, badge: extension, tone: 'language-extension' } : { icon, tone: icon }
}

export function fileVisualIcon(type: SftpEntryType, name = ''): string {
  return fileVisual(type, name).icon
}
