import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Accounting } from "../src/accounting";
describe("allowance accounting", () => {
  test("credits once and rejects mismatched replays", () => {
    const l = new Accounting(new Database(":memory:"), 100);
    expect(l.creditReceipt("r", "i", "alice", 50)).toBe(true);
    expect(l.creditReceipt("r", "i", "alice", 50)).toBe(false);
    expect(() => l.creditReceipt("r", "i2", "alice", 50)).toThrow();
    expect(() => l.creditReceipt("r2", "i", "bob", 50)).toThrow();
    expect(l.balance("alice")).toBe(50);
  });
  test("reserves, reconciles usage, and rejects duplicate settlement", () => {
    const l = new Accounting(new Database(":memory:"), 100);
    l.creditReceipt("r", "i", "alice", 60); l.reserve("one", "alice", 40);
    expect(() => l.reserve("two", "alice", 40)).toThrow("Insufficient allowance");
    expect(() => l.settle("one", 41)).toThrow();
    l.settle("one", 15); expect(l.balance("alice")).toBe(45);
    expect(() => l.settle("one", 15)).toThrow();
  });
  test("summarizes credited, available, reserved and charged allowance", () => {
    const db = new Database(":memory:");
    const ledger = new Accounting(db, 100);
    ledger.creditReceipt("r", "i", "alice", 80);
    ledger.reserve("used", "alice", 20);
    ledger.settle("used", 7);
    ledger.reserve("pending", "alice", 10);
    ledger.reserve("released", "alice", 5);
    ledger.release("released");
    expect(ledger.totals()).toEqual({credited:80,available:63,reserved:10,charged:7,settledRequests:1});
    db.close();
  });
  test("enforces project cap and releases definite failures", () => {
    const l = new Accounting(new Database(":memory:"), 50);
    l.creditReceipt("r1", "i1", "alice", 60); l.creditReceipt("r2", "i2", "bob", 60);
    l.reserve("one", "alice", 40);
    expect(() => l.reserve("two", "bob", 11)).toThrow("Project spending cap exceeded");
    l.release("one"); expect(l.balance("alice")).toBe(60); l.reserve("two", "bob", 50);
    expect(() => l.release("one")).toThrow();
  });
});

test("two processes cannot reserve the same allowance", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "promptplay-ledger-"));
  const path = join(dir, "ledger.sqlite");
  try {
    const db = new Database(path);
    new Accounting(db, 100).creditReceipt("r", "i", "alice", 100);
    db.close();
    const modulePath = new URL("../src/accounting.ts", import.meta.url).pathname;
    const script = `import { Database } from 'bun:sqlite'; import { Accounting } from ${JSON.stringify(modulePath)}; const db = new Database(process.argv[1]); db.exec('PRAGMA busy_timeout = 5000'); try { new Accounting(db, 100).reserve(process.argv[2], 'alice', 60); } catch { process.exit(2); }`;
    const processes = ["one", "two"].map((request) => Bun.spawn([process.execPath, "-e", script, path, request], {stdout:"ignore", stderr:"ignore"}));
    const results = await Promise.all(processes.map((p) => p.exited));
    expect(results.filter((code) => code === 0)).toHaveLength(1);
    const check = new Database(path);
    expect(new Accounting(check, 100).balance("alice")).toBe(40);
    check.close();
  } finally { rmSync(dir, {recursive:true, force:true}); }
});

test('persisted allowance, key and uncertain reservation survive a restart',async()=>{
  const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {GatewayKeys}=await import('../src/keys')
  const dir=mkdtempSync(join(tmpdir(),'promptplay-restart-')),path=join(dir,'ledger.sqlite')
  try {
    const first=new Database(path),ledger=new Accounting(first,1_000_000),keys=new GatewayKeys(first)
    ledger.creditReceipt('receipt','intent','alice.testnet',1_000_000);const key=keys.create('alice.testnet',1_000_000)
    ledger.reserve('uncertain','alice.testnet',120,key.id);first.close()
    const second=new Database(path),restored=new Accounting(second,1_000_000),restoredKeys=new GatewayKeys(second)
    expect(restored.balance('alice.testnet')).toBe(999_880);expect(restoredKeys.authenticate(key.key)?.account_id).toBe('alice.testnet')
    expect(restored.usage('alice.testnet')[0]).toMatchObject({state:'reserved',reserved:120})
    expect(()=>restored.creditReceipt('receipt','intent','alice.testnet',1_000_000)).not.toThrow();expect(restored.balance('alice.testnet')).toBe(999_880)
    second.close()
  } finally {rmSync(dir,{recursive:true,force:true})}
})
