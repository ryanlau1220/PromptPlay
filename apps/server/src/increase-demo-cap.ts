import { Database } from 'bun:sqlite'
import { increaseEconomyCap } from './economy'

const path=process.env.DEMO_DATABASE_PATH
const cap=Number(process.argv[2])
if(!path || !Number.isSafeInteger(cap) || cap<1) throw new Error('Set DEMO_DATABASE_PATH and provide the new lifetime cap in microunits.')
const db=new Database(path,{readwrite:true})
try {
  const result=increaseEconomyCap(db,cap)
  console.log(`Recorded lifetime cap increase: ${result.previous} → ${result.current} microunits.`)
  console.log('Set INFERENCE_CAP_MICROUNITS to the new value before restarting the server.')
} finally { db.close() }
