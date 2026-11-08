import type { Database } from 'bun:sqlite'
/** Freeze the demo's liabilities and price assumptions for this database. */
export function freezeEconomy(db:Database, settings:Record<string,string|number>) {
  db.exec('CREATE TABLE IF NOT EXISTS economy_settings (id INTEGER PRIMARY KEY CHECK(id=1), settings TEXT NOT NULL)')
  const canonical=JSON.stringify(Object.fromEntries(Object.entries(settings).sort(([a],[b])=>a.localeCompare(b))))
  db.transaction(()=>{
    const row=db.query('SELECT settings FROM economy_settings WHERE id=1').get() as {settings:string}|null
    if(row && row.settings!==canonical) throw new Error('Economy configuration differs from the recorded demo terms')
    if(!row)db.query('INSERT INTO economy_settings VALUES (1,?)').run(canonical)
  }).immediate()
}

/** An operator may increase, but never reduce, an existing demo's lifetime cap. */
export function increaseEconomyCap(db:Database, cap:number) {
  if(!Number.isSafeInteger(cap) || cap<1) throw new Error('Invalid demo cap')
  return db.transaction(()=>{
    const row=db.query('SELECT settings FROM economy_settings WHERE id=1').get() as {settings:string}|null
    if(!row) throw new Error('Demo economy has not been initialized')
    const settings=JSON.parse(row.settings) as Record<string,string|number>
    if(typeof settings.cap!=='number' || !Number.isSafeInteger(settings.cap) || cap<=settings.cap) throw new Error('New demo cap must exceed the existing cap')
    const previous=settings.cap
    const updated=JSON.stringify(Object.fromEntries(Object.entries({...settings,cap}).sort(([a],[b])=>a.localeCompare(b))))
    db.exec('CREATE TABLE IF NOT EXISTS economy_cap_changes (previous INTEGER NOT NULL, current INTEGER NOT NULL, changed_at INTEGER NOT NULL)')
    db.query('UPDATE economy_settings SET settings=? WHERE id=1').run(updated)
    db.query('INSERT INTO economy_cap_changes VALUES (?,?,?)').run(previous,cap,Date.now())
    return {previous,current:cap}
  }).immediate()
}
