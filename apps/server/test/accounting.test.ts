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
  test("enforces project cap and releases definite failures", () => {
    const l = new Accounting(new Database(":memory:"), 50);
    l.creditReceipt("r1", "i1", "alice", 60); l.creditReceipt("r2", "i2", "bob", 60);
    l.reserve("one", "alice", 40);
    expect(() => l.reserve("two", "bob", 11)).toThrow("Project spending cap exceeded");
    l.release("one"); expect(l.balance("alice")).toBe(60); l.reserve("two", "bob", 50);
    expect(() => l.release("one")).toThrow();
  });
});
