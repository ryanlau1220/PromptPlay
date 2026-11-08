import {expect,test} from 'bun:test'
import {Database} from 'bun:sqlite'
import {freezeEconomy,increaseEconomyCap} from '../src/economy'
test('funding and model assumptions cannot silently change after activation',()=>{
 const db=new Database(':memory:');freezeEconomy(db,{model:'a',cap:100});freezeEconomy(db,{cap:100,model:'a'})
 expect(()=>freezeEconomy(db,{model:'b',cap:100})).toThrow('differs')
 expect(()=>freezeEconomy(db,{model:'a',cap:200})).toThrow('differs')
})
test('explicit cap increases preserve recorded pricing and reject decreases',()=>{
 const db=new Database(':memory:');freezeEconomy(db,{model:'a',cap:100,price:2})
 expect(increaseEconomyCap(db,200)).toEqual({previous:100,current:200})
 freezeEconomy(db,{model:'a',cap:200,price:2})
 expect(()=>increaseEconomyCap(db,100)).toThrow('exceed')
 expect(()=>freezeEconomy(db,{model:'a',cap:200,price:3})).toThrow('differs')
 expect(db.query('SELECT previous,current FROM economy_cap_changes').all()).toEqual([{previous:100,current:200}])
})
