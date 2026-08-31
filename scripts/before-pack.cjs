// Rebuild before every package without disabling builder's production dependency
// collection (returning false from beforeBuild would disable that collection).
module.exports = async context => {
  const { Arch } = await import('electron-builder')
  const { rebuildNativeDependencies } = await import('./native-dependencies.mjs')
  await rebuildNativeDependencies({
    appDir: context.packager.info.appDir,
    electronVersion: context.packager.config.electronVersion,
    platform: context.electronPlatformName,
    arch: Arch[context.arch]
  })
}
