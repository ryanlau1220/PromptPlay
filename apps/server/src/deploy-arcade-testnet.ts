import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { Account, actions, JsonRpcProvider, KeyPairSigner, type KeyPairString } from 'near-api-js'

// Operator-only Testnet deployment. Never retry an uncertain transaction without reconciling the trace.
const owner = 'ryanlau1220.testnet',
  contract = 'arcade.ryanlau1220.testnet',
  token = 'token.ryanlau1220.testnet'
const rpc = new JsonRpcProvider({ url: process.env.NEAR_RPC_URL || 'https://test.rpc.fastnear.com' })
if ((await rpc.getNetworkId()) !== 'testnet') throw new Error('RPC is not Testnet')
try {
  await rpc.viewAccount({ accountId: contract })
  throw new Error('Contract account already exists; inspect chain before proceeding')
} catch (error) {
  if (!(error instanceof Error) || error.constructor.name !== 'AccountDoesNotExistError') throw error
}
const path = process.env.ARCADE_OWNER_KEY
if (!path) throw new Error('Set ARCADE_OWNER_KEY to the owner credential file')
const credential = (await Bun.file(path).json()) as { private_key: KeyPairString }
const signer = KeyPairSigner.fromSecretKey(credential.private_key),
  account = new Account(owner, rpc, signer)
const code = new Uint8Array(
  await Bun.file('contracts/arcade-settlement/target/near/arcade_settlement.wasm').arrayBuffer(),
)
if (!code.length) throw new Error('Build the settlement contract first')
const trace: {
  network: string
  owner: string
  contract: string
  token: string
  wasmSha256: string
  status: string
  deploymentTransaction?: string
  registrationTransaction?: string
} = {
  network: 'testnet',
  owner,
  contract,
  token,
  wasmSha256: createHash('sha256').update(code).digest('hex'),
  status: 'creating',
}
const tracePath = 'tmp/arcade-deployment.json'
const save = () => writeFile(tracePath, JSON.stringify(trace, null, 2), { mode: 0o600 })
await save()
try {
  const result = await account.signAndSendTransaction({
    receiverId: contract,
    actions: [
      actions.createAccount(),
      actions.transfer(3_000_000_000_000_000_000_000_000n),
      actions.addFullAccessKey(await signer.getPublicKey()),
      actions.deployContract(code),
      actions.functionCall('new', { token }, 30_000_000_000_000n, 0n),
    ],
    waitUntil: 'FINAL',
  })
  trace.deploymentTransaction = result.transaction.hash
  trace.status = 'deployed'
  await save()
  if (
    result.final_execution_status !== 'FINAL' ||
    !result.status ||
    typeof result.status !== 'object' ||
    !('SuccessValue' in result.status)
  )
    throw new Error('Deployment did not finalize successfully')
  const registration = await account.callFunctionRaw({
    contractId: token,
    methodName: 'storage_deposit',
    args: { account_id: contract, registration_only: true },
    gas: 30_000_000_000_000n,
    deposit: 2_000_000_000_000_000_000_000n,
    waitUntil: 'FINAL',
  })
  trace.registrationTransaction = registration.transaction.hash
  trace.status = 'registered'
  await save()
  if (
    registration.final_execution_status !== 'FINAL' ||
    !registration.status ||
    typeof registration.status !== 'object' ||
    !('SuccessValue' in registration.status)
  )
    throw new Error('Token registration did not finalize successfully')
  if (!(await rpc.callFunction({ contractId: token, method: 'storage_balance_of', args: { account_id: contract } })))
    throw new Error('Contract token registration not visible')
  trace.status = 'verified'
  await save()
  console.log(JSON.stringify(trace))
} catch (error) {
  trace.status = 'needs-reconciliation'
  await save()
  console.error(`Inspect ${tracePath} and chain state before retrying.`)
  throw error
}
