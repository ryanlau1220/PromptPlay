import { useNearWallet } from 'near-connect-hooks'
import { useState } from 'react'
import { GAME, pcc, type Match } from '../lib/game'
import { useSession } from './Session'

export function MatchHistory({account,onSelect}:{account:string;onSelect:(id:string)=>void}) {
  const {viewFunction}=useNearWallet()
  const {request}=useSession()
  const [matches,setMatches]=useState<Match[]>([])
  const [cursor,setCursor]=useState<bigint|null>(null)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [eventMatch,setEventMatch]=useState('')
  const [events,setEvents]=useState<Array<{sequence:number;event:string;tx_hash:string}>>([])
  async function loadEvents(id:string){
    setBusy(true);setError('')
    try{const data=await request<{events:typeof events}>(`/api/matches/${encodeURIComponent(id)}/events`);setEventMatch(id);setEvents(data.events)}
    catch{setError('Could not load match events.')}
    finally{setBusy(false)}
  }
  async function load() {
    setBusy(true);setError('')
    try {
      const end=cursor ?? BigInt(await viewFunction({contractId:GAME,method:'get_match_count',args:{}}) as string)
      const start=end>25n ? end-25n : 0n
      const ids=Array.from({length:Number(end-start)},(_,i)=>(end-1n-BigInt(i)).toString())
      const games=await Promise.all(ids.map(match_id=>viewFunction({contractId:GAME,method:'get_match',args:{match_id}}) as Promise<Match|null>))
      setMatches(previous=>[...previous,...games.filter((m):m is Match=>m?.players.some(player=>player.account===account) === true)])
      setCursor(start)
    }catch{setError('Could not load match history.')}
    finally{setBusy(false)}
  }
  const wins=matches.filter(match=>match.winner===account).length
  const losses=matches.filter(match=>match.winner && match.winner!==account).length
  return <details><summary>Match history</summary>
    <p>{wins} wins · {losses} losses · {matches.length} matches loaded</p>
    {matches.map(match=><div key={match.id}><button type="button" className="btn-ghost" onClick={()=>onSelect(match.id)}>#{match.id} · {match.phase} · {pcc(match.stake)} PCC</button><button type="button" className="btn-ghost" disabled={busy} onClick={()=>void loadEvents(match.id)}>Events</button></div>)}
    {eventMatch && <div>Match #{eventMatch}: {events.length===0 ? 'No indexed events yet.' : events.map(event=><a key={event.sequence} href={`https://testnet.nearblocks.io/txns/${event.tx_hash}`} target="_blank" rel="noreferrer">{event.sequence} · {event.event} </a>)}</div>}
    {(cursor===null || cursor>0n) && <button type="button" className="btn-ghost" disabled={busy} onClick={()=>void load()}>{busy?'Loading…':cursor===null?'Load history':'Load more'}</button>}
    {error && <p role="alert">{error}</p>}
  </details>
}
