import type { Database } from 'bun:sqlite'
import { createHash, randomBytes } from 'node:crypto'
import type { JsonRpcProvider } from 'near-api-js'
import { verifyMessage } from 'near-api-js/nep413'

const MESSAGE = 'Sign in to PromptPlay on NEAR Testnet.'
const RECIPIENT = 'game.ryanlau1220.testnet'
const CHALLENGE_MS = 5 * 60_000
const SESSION_MS = 12 * 60 * 60_000
const digest = (s:string) => createHash('sha256').update(s).digest('hex')
type Verify = typeof verifyMessage

export class WalletAuth {
  constructor(private db:Database, private provider:JsonRpcProvider, private verify:Verify = verifyMessage) {
    db.exec(`CREATE TABLE IF NOT EXISTS auth_challenges (id TEXT PRIMARY KEY, nonce TEXT NOT NULL, expires INTEGER NOT NULL, consumed INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS auth_sessions (token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL, expires INTEGER NOT NULL);`)
  }
  challenge() {
    const id = randomBytes(32).toString('base64url'); const nonce = randomBytes(32).toString('base64'); const expires = Date.now() + CHALLENGE_MS
    this.db.query('DELETE FROM auth_challenges WHERE expires < ?').run(Date.now())
    this.db.query('INSERT INTO auth_challenges (id,nonce,expires) VALUES (?,?,?)').run(id,nonce,expires)
    return {id,nonce,message:MESSAGE,recipient:RECIPIENT,expires}
  }
  async signIn(input:{challengeId:string; accountId:string; publicKey:string; signature:string}) {
    if (!/^[a-z0-9._-]{2,64}$/.test(input.accountId) || !input.accountId.endsWith('.testnet') || !/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,50}$/.test(input.publicKey) || !/^[A-Za-z0-9+/]{86}==$/.test(input.signature)) throw new Error('Invalid wallet signature')
    const row = this.db.query('SELECT nonce, expires, consumed FROM auth_challenges WHERE id = ?').get(input.challengeId) as {nonce:string; expires:number; consumed:number}|null
    if (!row || row.consumed || row.expires <= Date.now()) throw new Error('Challenge expired or used')
    await this.verify({signerAccountId:input.accountId, signerPublicKey:input.publicKey, signature:Uint8Array.from(Buffer.from(input.signature,'base64')), payload:{message:MESSAGE,recipient:RECIPIENT,nonce:Uint8Array.from(Buffer.from(row.nonce,'base64'))}, provider:this.provider})
    const token = randomBytes(32).toString('base64url'); const expires = Date.now()+SESSION_MS
    this.db.transaction(() => {
      const updated = this.db.query('UPDATE auth_challenges SET consumed=1 WHERE id=? AND consumed=0 AND expires > ?').run(input.challengeId,Date.now())
      if (updated.changes !== 1) throw new Error('Challenge expired or used')
      this.db.query('INSERT INTO auth_sessions VALUES (?,?,?)').run(digest(token),input.accountId,expires)
    }).immediate()
    return {token,accountId:input.accountId,expires}
  }
  account(token:string):string | null {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null
    const row = this.db.query('SELECT account_id FROM auth_sessions WHERE token_hash=? AND expires > ?').get(digest(token),Date.now()) as {account_id:string}|null
    return row?.account_id ?? null
  }
  revoke(token:string) { this.db.query('DELETE FROM auth_sessions WHERE token_hash=?').run(digest(token)) }
}
