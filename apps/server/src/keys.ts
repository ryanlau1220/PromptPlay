import { Database } from 'bun:sqlite'
import { createHash, randomBytes } from 'node:crypto'
const hash = (s:string) => createHash('sha256').update(s).digest('hex')
export class GatewayKeys {
  constructor(private db:Database) { db.exec('CREATE TABLE IF NOT EXISTS gateway_keys (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE, quota INTEGER NOT NULL CHECK(quota > 0), revoked INTEGER NOT NULL DEFAULT 0)') }
  create(account:string,quota:number) {
    if(!Number.isSafeInteger(quota) || quota < 1 || quota > 1_000_000_000) throw new Error('Invalid quota')
    const id=randomBytes(18).toString('base64url'); const key=`pp_${randomBytes(32).toString('base64url')}`
    this.db.query('INSERT INTO gateway_keys (id,account_id,key_hash,quota) VALUES (?,?,?,?)').run(id,account,hash(key),quota)
    return {id,key,quota}
  }
  authenticate(key:string) {
    if(!/^pp_[A-Za-z0-9_-]{43}$/.test(key)) return null
    return this.db.query('SELECT id,account_id,quota FROM gateway_keys WHERE key_hash=? AND revoked=0').get(hash(key)) as {id:string;account_id:string;quota:number}|null
  }
  list(account:string) { return this.db.query('SELECT id, quota, revoked FROM gateway_keys WHERE account_id=? ORDER BY rowid DESC LIMIT 50').all(account) }
  revoke(account:string,id:string) { return this.db.query('UPDATE gateway_keys SET revoked=1 WHERE account_id=? AND id=? AND revoked=0').run(account,id).changes===1 }
}
