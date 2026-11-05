import {expect,test} from 'bun:test'
import {Database} from 'bun:sqlite'
import {freezeEconomy} from '../src/economy'
test('funding and model assumptions cannot silently change after activation',()=>{
 const db=new Database(':memory:');freezeEconomy(db,{model:'a',cap:100});freezeEconomy(db,{cap:100,model:'a'})
 expect(()=>freezeEconomy(db,{model:'b',cap:100})).toThrow('differs')
 expect(()=>freezeEconomy(db,{model:'a',cap:200})).toThrow('differs')
})
