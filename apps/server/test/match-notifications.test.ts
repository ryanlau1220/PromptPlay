import { expect,test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { MatchNotifications } from '../src/match-notifications'
const sub={endpoint:'https://fcm.googleapis.com/fcm/send/example',keys:{p256dh:'a'.repeat(87),auth:'b'.repeat(22)}}
test('only participants can subscribe and a resolved match is sent once',async()=>{
 const db=new Database(':memory:');let phase='Committing';const messages:string[]=[]
 const service=new MatchNotifications(db,async()=>({phase,winner:'alice.testnet',players:[{account:'alice.testnet'},{account:'bob.testnet'}]}),async(_,payload)=>{messages.push(payload)},'key')
 await expect(service.subscribe('eve.testnet','4',sub)).rejects.toThrow('not found')
 await expect(service.subscribe('alice.testnet','4',{...sub,endpoint:'https://localhost:1234/'})).rejects.toThrow('endpoint')
 await service.subscribe('alice.testnet','4',sub);await service.poll();expect(messages).toHaveLength(0)
 phase='Completed';await service.poll();await service.poll();expect(messages).toHaveLength(1);expect(JSON.parse(messages[0])).toMatchObject({matchId:'4',winner:'alice.testnet'})
 db.close()
})
test('expired subscriptions are removed and temporary delivery failures retry',async()=>{
 const db=new Database(':memory:');let status=503,calls=0
 const service=new MatchNotifications(db,async()=>({phase:'Committing',winner:null,players:[{account:'alice.testnet'}]}),async()=>{calls++;throw {statusCode:status}},'key')
 await service.subscribe('alice.testnet','5',sub)
 const poller=new MatchNotifications(db,async()=>({phase:'Cancelled',winner:null,players:[{account:'alice.testnet'}]}),async()=>{calls++;throw {statusCode:status}},'key')
 await poller.poll();status=410;await poller.poll();await poller.poll();expect(calls).toBe(2);db.close()
})
