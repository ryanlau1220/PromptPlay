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
