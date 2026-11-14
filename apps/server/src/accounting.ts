import type { Database } from "bun:sqlite";

// Receipts may be credited only by a trusted verifier after finalized chain execution.
export class Accounting {
  constructor(private db: Database, private spendingCap: number) {
    amount(spendingCap);
    db.exec(`PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0));
      CREATE TABLE IF NOT EXISTS receipts (receipt_id TEXT PRIMARY KEY, intent_id TEXT NOT NULL UNIQUE, account_id TEXT NOT NULL REFERENCES accounts(id), amount INTEGER NOT NULL CHECK(amount > 0));
      CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), key_id TEXT, reserved INTEGER NOT NULL CHECK(reserved > 0), charged INTEGER, input_tokens INTEGER, output_tokens INTEGER, state TEXT NOT NULL CHECK(state IN ('reserved','settled','released')));
      CREATE TABLE IF NOT EXISTS gateway_active (request_id TEXT PRIMARY KEY, account_id TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS gateway_rates (account_id TEXT PRIMARY KEY, start INTEGER NOT NULL, count INTEGER NOT NULL);`);
  }
  creditReceipt(receiptId: string, intentId: string, accountId: string, units: number): boolean {
    id(receiptId); id(intentId); id(accountId); amount(units);
    return this.db.transaction(() => {
      const old = this.db.query("SELECT * FROM receipts WHERE receipt_id = ? OR intent_id = ?").get(receiptId, intentId) as {receipt_id:string; intent_id:string; account_id:string; amount:number} | null;
      if (old) {
        if (old.receipt_id !== receiptId || old.intent_id !== intentId || old.account_id !== accountId || old.amount !== units) throw new Error("Receipt or intent already used");
        return false;
      }
      this.db.query("INSERT INTO accounts (id) VALUES (?) ON CONFLICT DO NOTHING").run(accountId);
      const { reserved } = this.db.query("SELECT COALESCE(SUM(reserved), 0) AS reserved FROM requests WHERE account_id = ? AND state = 'reserved'").get(accountId) as {reserved:number};
      if (!Number.isSafeInteger(this.balance(accountId) + reserved + units)) throw new Error("Balance overflow");
      this.db.query("INSERT INTO receipts VALUES (?, ?, ?, ?)").run(receiptId, intentId, accountId, units);
      this.db.query("UPDATE accounts SET balance = balance + ? WHERE id = ?").run(units, accountId);
      return true;
    }).immediate();
  }
  reserve(requestId: string, accountId: string, units: number, keyId?: string, now?: number): void {
    id(requestId); id(accountId); amount(units);
    this.db.transaction(() => {
      if (now !== undefined) {
        if (!Number.isSafeInteger(now) || now < 0) throw new Error("Invalid request time");
        this.db.query("DELETE FROM gateway_active WHERE expires <= ?").run(now);
        const active = this.db.query("SELECT COUNT(*) AS total, COALESCE(SUM(account_id = ?),0) AS user FROM gateway_active").get(accountId) as {total:number; user:number};
        if (active.total >= 8 || active.user >= 2) throw new Error("Concurrency limit exceeded");
        const rate = this.db.query("SELECT start,count FROM gateway_rates WHERE account_id = ?").get(accountId) as {start:number;count:number}|null;
        if (rate && now - rate.start < 60_000 && rate.count >= 10) throw new Error("Rate limit exceeded");
        this.db.query("INSERT INTO gateway_rates VALUES (?,?,1) ON CONFLICT(account_id) DO UPDATE SET start = CASE WHEN excluded.start - start >= 60000 THEN excluded.start ELSE start END, count = CASE WHEN excluded.start - start >= 60000 THEN 1 ELSE count + 1 END").run(accountId,now);
        this.db.query("INSERT INTO gateway_active VALUES (?,?,?)").run(requestId,accountId,now+150_000);
      }
      const {total} = this.db.query("SELECT COALESCE(SUM(CASE WHEN state = 'reserved' THEN reserved WHEN state = 'settled' THEN charged ELSE 0 END), 0) AS total FROM requests").get() as {total:number};
      if (!Number.isSafeInteger(total + units) || total + units > this.spendingCap) throw new Error("Project spending cap exceeded");
      if (keyId) {
        const key = this.db.query("SELECT quota FROM gateway_keys WHERE id = ? AND account_id = ? AND revoked = 0").get(keyId,accountId) as {quota:number} | null;
        const used = this.db.query("SELECT COALESCE(SUM(CASE WHEN state = 'reserved' THEN reserved WHEN state = 'settled' THEN charged ELSE 0 END), 0) AS total FROM requests WHERE key_id = ?").get(keyId) as {total:number};
        if (!key || !Number.isSafeInteger(used.total + units) || used.total + units > key.quota) throw new Error("Key quota exceeded or revoked");
      }
      if (this.db.query("UPDATE accounts SET balance = balance - ? WHERE id = ? AND balance >= ?").run(units, accountId, units).changes !== 1) throw new Error("Insufficient allowance");
      this.db.query("INSERT INTO requests (id, account_id, key_id, reserved, state) VALUES (?, ?, ?, ?, 'reserved')").run(requestId, accountId, keyId ?? null, units);
    }).immediate();
  }
  endActivity(requestId:string):void { this.db.query("DELETE FROM gateway_active WHERE request_id = ?").run(requestId) }
  settle(requestId: string, used: number, usage?: {inputTokens:number; outputTokens:number}): void {
    if (!Number.isSafeInteger(used) || used < 0) throw new Error("Invalid usage");
    if (usage && (!Number.isSafeInteger(usage.inputTokens) || usage.inputTokens < 0 || !Number.isSafeInteger(usage.outputTokens) || usage.outputTokens < 0)) throw new Error("Invalid token usage");
    this.finish(requestId, used, "settled", usage);
  }
  // Only use when upstream definitely did not execute; uncertain requests remain reserved.
  release(requestId: string): void { this.finish(requestId, 0, "released"); }
  private finish(requestId: string, used: number, state: "settled" | "released", usage?: {inputTokens:number; outputTokens:number}): void {
    id(requestId);
    this.db.transaction(() => {
      const req = this.db.query("SELECT account_id, reserved, state FROM requests WHERE id = ?").get(requestId) as {account_id:string; reserved:number; state:string} | null;
      if (!req || req.state !== "reserved") throw new Error("Request is not reserved");
      if (used > req.reserved) throw new Error("Usage exceeds reservation");
      this.db.query("UPDATE requests SET state = ?, charged = ?, input_tokens = ?, output_tokens = ? WHERE id = ?").run(state, used, usage?.inputTokens ?? null, usage?.outputTokens ?? null, requestId);
      this.db.query("UPDATE accounts SET balance = balance + ? WHERE id = ?").run(req.reserved - used, req.account_id);
    }).immediate();
  }
  totals() {
    const { credited, available, reserved, charged, settledRequests } = this.db.query(`
      SELECT
        (SELECT COALESCE(SUM(amount), 0) FROM receipts) AS credited,
        (SELECT COALESCE(SUM(balance), 0) FROM accounts) AS available,
        COALESCE(SUM(CASE WHEN state = 'reserved' THEN reserved ELSE 0 END), 0) AS reserved,
        COALESCE(SUM(CASE WHEN state = 'settled' THEN charged ELSE 0 END), 0) AS charged,
        COUNT(CASE WHEN state = 'settled' THEN 1 END) AS settledRequests
      FROM requests
    `).get() as { credited: number; available: number; reserved: number; charged: number; settledRequests: number }
    return { credited, available, reserved, charged, settledRequests }
  }
  issuanceLimit(): number { return this.spendingCap }
  usage(accountId: string) {
    return this.db.query("SELECT id, reserved, charged, input_tokens, output_tokens, state FROM requests WHERE account_id = ? ORDER BY rowid DESC LIMIT 100").all(accountId) as Array<{id:string; reserved:number; charged:number|null; input_tokens:number|null; output_tokens:number|null; state:string}>
  }
  balance(accountId: string): number {
    return (this.db.query("SELECT balance FROM accounts WHERE id = ?").get(accountId) as {balance:number} | null)?.balance ?? 0;
  }
}
function amount(n: number): void { if (!Number.isSafeInteger(n) || n <= 0) throw new Error("Amount must be a positive safe integer"); }
function id(s: string): void { if (!s || s.length > 256) throw new Error("Invalid ID"); }
