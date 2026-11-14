import { useNearWallet } from 'near-connect-hooks'
import { useRef, useState } from 'react'
import { GAME, matchEconomy, pcc, type Match } from '../lib/game'
import { useSession } from './Session'

export function MatchHistory({account,onSelect}:{account:string;onSelect:(id:string)=>void}) {
  const {viewFunction}=useNearWallet()
  const {request}=useSession()
  const [matches,setMatches]=useState<Match[]>([])
  const [cursor,setCursor]=useState<bigint|null>(null)
  const [busy,setBusy]=useState(false)
  const running=useRef(false)
  const [error,setError]=useState('')
  const [eventMatch,setEventMatch]=useState('')
  const [events,setEvents]=useState<Array<{sequence:number;event:string;tx_hash:string}>>([])
  async function loadEvents(id:string){
    if(running.current)return
    running.current=true
    setBusy(true);setError('')
    try{const data=await request<{events:typeof events}>(`/api/matches/${encodeURIComponent(id)}/events`);setEventMatch(id);setEvents(data.events)}
    catch{setError('Could not load match events.')}
    finally{running.current=false;setBusy(false)}
  }
  async function load() {
    if(running.current)return
    running.current=true
    setBusy(true);setError('')
    try {
      const end=cursor ?? BigInt(await viewFunction({contractId:GAME,method:'get_match_count',args:{}}) as string)
      const start=end>25n ? end-25n : 0n
      const ids=Array.from({length:Number(end-start)},(_,i)=>(end-1n-BigInt(i)).toString())
      const page: Match[] = []
      for (let offset=0;offset<ids.length;offset+=5) {
        const batch=await Promise.all(ids.slice(offset,offset+5).map(match_id=>viewFunction({contractId:GAME,method:'get_match',args:{match_id}}) as Promise<Match|null>))
        page.push(...batch.filter((match):match is Match=>match?.players.some(player=>player.account===account) === true))
      }
      setMatches(previous=>[...previous,...page])
      setCursor(start)
    }catch{setError('Could not load match history.')}
    finally{running.current=false;setBusy(false)}
  }
  const wins=matches.filter(match=>match.winner===account).length
  const losses=matches.filter(match=>match.winner && match.winner!==account).length
  const completed=matches.filter(match=>match.phase==='Completed').length
  const settled=matches.reduce((total,match)=>total+matchEconomy(match).paid,0n)
  return <details className="match-history"><summary>Match history</summary>
    {cursor === null ? <p>Load your recent Testnet duels and payout history.</p> : <p>{wins} wins · {losses} losses · {matches.length} matches loaded</p>}
    {matches.length > 0 && <p>{completed} completed · {pcc(settled.toString())} PCC paid to players across loaded matches, including refunds</p>}
    {wins > 0 && <p>{wins === 1 ? 'First Testnet win' : `${wins} Testnet wins`} recorded in loaded history.</p>}
    {matches.map(match=><div className="match-history-row" key={match.id}><button type="button" className="btn-ghost" onClick={()=>onSelect(match.id)}>#{match.id} · {match.phase} · {pcc(match.stake)} PCC</button><button type="button" className="btn-ghost" disabled={busy} onClick={()=>void loadEvents(match.id)}>Events<span className="visually-hidden"> for match {match.id}</span></button></div>)}
    {eventMatch && <div>Match #{eventMatch}: {events.length===0 ? 'No indexed events yet.' : events.map(event=><a key={event.sequence} href={`https://testnet.nearblocks.io/txns/${event.tx_hash}`} target="_blank" rel="noreferrer">{event.sequence} · {event.event} </a>)}</div>}
    {(cursor===null || cursor>0n) && <button type="button" className="btn-ghost" disabled={busy} onClick={()=>void load()}>{busy?'Loading…':cursor===null?'Load history':'Load more'}</button>}
    {error && <p role="alert">{error}</p>}
  </details>
}
