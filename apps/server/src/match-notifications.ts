import type { Database } from 'bun:sqlite'
import { RequestError } from './errors'

export type PushSubscription = {endpoint:string;keys:{p256dh:string;auth:string}}
type Match = {phase:string;winner:string|null;players:Array<{account:string}>}
type Sender = (subscription:PushSubscription,payload:string)=>Promise<void>
type Viewer = (id:string)=>Promise<Match|null>

/** Tracks explicit opt-ins and only sends after finalized chain state resolves a match. */
export class MatchNotifications {
  constructor(private db:Database,private view:Viewer,private send:Sender,readonly publicKey:string){
    db.exec(`CREATE TABLE IF NOT EXISTS match_push (account TEXT NOT NULL, match_id TEXT NOT NULL, endpoint TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, sent INTEGER NOT NULL DEFAULT 0, checked INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(account,match_id,endpoint))`)
  }
  async subscribe(account:string,id:string,subscription:PushSubscription){
    if(!/^\d{1,20}$/.test(id)||BigInt(id)>2n**64n-1n)throw new RequestError('Invalid match',400)
    let url:URL
    try{url=new URL(subscription.endpoint)}catch{throw new RequestError('Invalid push endpoint',400)}
    const host=url.hostname
    if(url.protocol!=='https:' || url.username || url.password || url.port || !(host==='fcm.googleapis.com'||/^jmt[0-9]{1,3}\.google\.com$/.test(host)||host==='updates.push.services.mozilla.com'||host.endsWith('.push.apple.com')||host.endsWith('.notify.windows.com')))throw new RequestError('Unsupported push endpoint',400)
    if(subscription.endpoint.length>2048 || !/^[A-Za-z0-9_-]{87}$/.test(subscription.keys.p256dh) || !/^[A-Za-z0-9_-]{22}$/.test(subscription.keys.auth))throw new RequestError('Invalid push keys',400)
    const match=await this.view(id)
    if(!match || !match.players.some(p=>p.account===account))throw new RequestError('Match not found',404)
    if(match.phase==='Completed'||match.phase==='Cancelled')throw new RequestError('Match is already resolved',409)
    this.db.query('INSERT INTO match_push (account,match_id,endpoint,p256dh,auth) VALUES (?,?,?,?,?) ON CONFLICT(account,match_id,endpoint) DO UPDATE SET p256dh=excluded.p256dh,auth=excluded.auth,sent=0').run(account,id,subscription.endpoint,subscription.keys.p256dh,subscription.keys.auth)
    return {subscribed:true}
  }
  async poll(){
    const rows=this.db.query('SELECT account,match_id,endpoint,p256dh,auth FROM match_push WHERE sent=0 ORDER BY checked LIMIT 100').all() as Array<{account:string;match_id:string;endpoint:string;p256dh:string;auth:string}>
    const matches=new Map<string,Match|null>()
    for(const row of rows){
      this.db.query('UPDATE match_push SET checked=? WHERE account=? AND match_id=? AND endpoint=?').run(Date.now(),row.account,row.match_id,row.endpoint)
      if(!matches.has(row.match_id))matches.set(row.match_id,await this.view(row.match_id))
      const match=matches.get(row.match_id)
      if(!match || !['Completed','Cancelled'].includes(match.phase))continue
      try{
        await this.send({endpoint:row.endpoint,keys:{p256dh:row.p256dh,auth:row.auth}},JSON.stringify({matchId:row.match_id,winner:match.winner,phase:match.phase}))
        this.db.query('UPDATE match_push SET sent=1 WHERE account=? AND match_id=? AND endpoint=?').run(row.account,row.match_id,row.endpoint)
      }catch(error){
        const status=(error as {statusCode?:number}).statusCode
        if(status===404 || status===410)this.db.query('DELETE FROM match_push WHERE account=? AND match_id=? AND endpoint=?').run(row.account,row.match_id,row.endpoint)
      }
    }
  }
}
