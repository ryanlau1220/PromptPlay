import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useNearWallet } from 'near-connect-hooks'
import { fromBase64 } from '../lib/game'
export const API = import.meta.env.VITE_API_URL || 'http://localhost:3001'
export type ServerConfig = {redemptionAvailable:boolean;faucetAvailable:boolean;microsPerUnit:number|null;maxOutputTokens:number|null;pccPerUnit:string}
type Session = {token:string;config:ServerConfig|null;login:()=>Promise<string>;request:(path:string,method?:string,body?:unknown,token?:string)=>Promise<any>}
const Context=createContext<Session|null>(null)
export function useSession(){const value=useContext(Context);if(!value)throw new Error('Session provider missing');return value}
export function SessionProvider({children}:{children:ReactNode}){
  const {signedAccountId:account,signNEP413Message}=useNearWallet();const [token,setToken]=useState('');const [config,setConfig]=useState<ServerConfig|null>(null)
  useEffect(()=>{let active=true;setToken('');fetch(`${API}/config`).then(r=>r.json()).then(c=>{if(active)setConfig(c)}).catch(()=>{if(active)setConfig(null)});return()=>{active=false}},[account])
  async function request(path:string,method='GET',body?:unknown,auth=token){
    const res=await fetch(`${API}${path}`,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(auth?{authorization:`Bearer ${auth}`}:{})},body:body?JSON.stringify(body):undefined})
    const data=await res.json();if(!res.ok)throw new Error(typeof data.error==='string'?data.error:'Request failed.');return data
  }
  async function login(){
    const c=await request('/api/auth/challenge','POST');const signed=await signNEP413Message({message:c.message,recipient:c.recipient,nonce:fromBase64(c.nonce)})
    if(signed.accountId!==account)throw new Error('The signed wallet does not match the connected account.')
    const result=await request('/api/auth/verify','POST',{challengeId:c.id,accountId:signed.accountId,publicKey:signed.publicKey,signature:signed.signature})
    setToken(result.token);return result.token as string
  }
  return <Context.Provider value={{token,config,login,request}}>{children}</Context.Provider>
}
