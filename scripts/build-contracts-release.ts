import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import evidence from '../deployments/testnet.json'

const commit = evidence.computeCredit.sourceCommit
if (!/^[a-f0-9]{40}$/.test(commit) || evidence.rpsGame.sourceCommit !== commit) throw new Error('Contract source commits do not match')
const root = process.cwd(), directory = await mkdtemp(join(tmpdir(), 'promptplay-release-'))
async function run(command: string[], cwd: string) {
  const process = Bun.spawn(command, { cwd, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' })
  if (await process.exited !== 0) throw new Error(`${command[0]} failed`)
}
try {
  const checkout = join(directory, 'source')
  await run(['git', 'clone', '--quiet', '--no-hardlinks', root, checkout], root)
  await run(['git', 'checkout', '--quiet', '--detach', commit], checkout)
  for (const [folder, name, expected] of [
    ['compute-credit', 'compute_credit.wasm', evidence.computeCredit.wasmSha256],
    ['rps-game', 'rps_game.wasm', evidence.rpsGame.wasmSha256],
  ]) {
    const out = join(directory, folder)
    await mkdir(out)
    await run(['cargo', 'near', 'build', 'reproducible-wasm', '--out-dir', out], join(checkout, 'contracts', folder))
    const artifact = join(out, name)
    const actual = createHash('sha256').update(await readFile(artifact)).digest('hex')
    if (actual !== expected) throw new Error(`${folder} build does not match the recorded deployment`)
    const destination = resolve(root, 'contracts', folder, 'target', 'reproducible')
    await mkdir(destination, { recursive: true })
    await copyFile(artifact, join(destination, name))
    console.log(`${folder}: reproducible deployment hash verified`)
  }
} finally {
  await rm(directory, { recursive: true, force: true })
}
