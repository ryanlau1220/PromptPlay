import { Database } from "bun:sqlite";

// Receipts may be credited only by a trusted verifier after finalized chain execution.
export class Accounting {
  constructor(private db: Database, private spendingCap: number) {
    amount(spendingCap);
    db.exec(`PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0));
      CREATE TABLE IF NOT EXISTS receipts (receipt_id TEXT PRIMARY KEY, intent_id TEXT NOT NULL UNIQUE, account_id TEXT NOT NULL REFERENCES accounts(id), amount INTEGER NOT NULL CHECK(amount > 0));
      CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), reserved INTEGER NOT NULL CHECK(reserved > 0), charged INTEGER, state TEXT NOT NULL CHECK(state IN ('reserved','settled','released')));`);
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
  reserve(requestId: string, accountId: string, units: number): void {
    id(requestId); id(accountId); amount(units);
    this.db.transaction(() => {
      const {total} = this.db.query("SELECT COALESCE(SUM(CASE WHEN state = 'reserved' THEN reserved WHEN state = 'settled' THEN charged ELSE 0 END), 0) AS total FROM requests").get() as {total:number};
      if (!Number.isSafeInteger(total + units) || total + units > this.spendingCap) throw new Error("Project spending cap exceeded");
      if (this.db.query("UPDATE accounts SET balance = balance - ? WHERE id = ? AND balance >= ?").run(units, accountId, units).changes !== 1) throw new Error("Insufficient allowance");
      this.db.query("INSERT INTO requests (id, account_id, reserved, state) VALUES (?, ?, ?, 'reserved')").run(requestId, accountId, units);
    }).immediate();
  }
  settle(requestId: string, used: number): void {
    if (!Number.isSafeInteger(used) || used < 0) throw new Error("Invalid usage");
    this.finish(requestId, used, "settled");
  }
  // Only use when upstream definitely did not execute; uncertain requests remain reserved.
  release(requestId: string): void { this.finish(requestId, 0, "released"); }
  private finish(requestId: string, used: number, state: "settled" | "released"): void {
    id(requestId);
    this.db.transaction(() => {
      const req = this.db.query("SELECT account_id, reserved, state FROM requests WHERE id = ?").get(requestId) as {account_id:string; reserved:number; state:string} | null;
      if (!req || req.state !== "reserved") throw new Error("Request is not reserved");
      if (used > req.reserved) throw new Error("Usage exceeds reservation");
      this.db.query("UPDATE requests SET state = ?, charged = ? WHERE id = ?").run(state, used, requestId);
      this.db.query("UPDATE accounts SET balance = balance + ? WHERE id = ?").run(req.reserved - used, req.account_id);
    }).immediate();
  }
  balance(accountId: string): number {
    return (this.db.query("SELECT balance FROM accounts WHERE id = ?").get(accountId) as {balance:number} | null)?.balance ?? 0;
  }
}
function amount(n: number): void { if (!Number.isSafeInteger(n) || n <= 0) throw new Error("Amount must be a positive safe integer"); }
function id(s: string): void { if (!s || s.length > 256) throw new Error("Invalid ID"); }
