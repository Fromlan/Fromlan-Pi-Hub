/**
 * Local/CI packaging entry. Sets China-friendly download mirrors when GitHub
 * is unreachable, then runs electron-vite build + electron-builder.
 *
 * Override mirrors by setting ELECTRON_MIRROR / ELECTRON_BUILDER_BINARIES_MIRROR
 * before calling npm run dist.
 */
import { spawnSync } from "node:child_process"

process.env.ELECTRON_MIRROR ??= "https://npmmirror.com/mirrors/electron/"
process.env.ELECTRON_BUILDER_BINARIES_MIRROR ??=
  "https://npmmirror.com/mirrors/electron-builder-binaries/"
process.env.CSC_IDENTITY_AUTO_DISCOVERY ??= "false"

function run(commandLine) {
  const result = spawnSync(commandLine, { stdio: "inherit", shell: true, env: process.env })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

run("npx electron-vite build")
run("npx electron-builder")
