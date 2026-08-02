import { readdir, rename, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const outputDirectory = resolve(process.argv[2] ?? 'release')
const architectureMappings = [
  ['-Linux-amd64.deb', '-Linux-x64.deb'],
  ['-Linux-x86_64.rpm', '-Linux-x64.rpm'],
  ['-Linux-aarch64.rpm', '-Linux-arm64.rpm']
]

for (const fileName of await readdir(outputDirectory)) {
  const mapping = architectureMappings.find(([sourceSuffix]) => fileName.endsWith(sourceSuffix))
  if (!mapping) continue

  const [sourceSuffix, targetSuffix] = mapping
  const targetName = fileName.slice(0, -sourceSuffix.length) + targetSuffix
  const sourcePath = resolve(outputDirectory, fileName)
  const targetPath = resolve(outputDirectory, targetName)

  await rm(targetPath, { force: true })
  await rename(sourcePath, targetPath)
  console.log(`已统一安装包名称：${fileName} -> ${targetName}`)
}
