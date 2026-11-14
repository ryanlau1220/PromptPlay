import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from 'react'
import { useNearWallet } from 'near-connect-hooks'
import { fromBase64 } from '../lib/game'
export const API = (import.meta.env.VITE_API_URL || 'http://localhost:3001').replace(/\/+$/, '')
export type ServerConfig = {redemptionAvailable:boolean;redemptionUnitsAvailable:number|null;escrowAccount:string|null;faucetAvailable:boolean;provider:string|null;model:string|null;capabilities:{streaming:boolean;toolCalls:boolean}|null;contextTokens:number|null;microsPerUnit:number|null;maxOutputTokens:number|null;pccPerUnit:string}
type Session = {token:string;config:ServerConfig|null;configStatus:'loading'|'ready'|'unavailable';refreshConfig:()=>Promise<void>;login:()=>Promise<string>;request:<T = unknown>(path:string,method?:string,body?:unknown,token?:string)=>Promise<T>}
const Context=createContext<Session|null>(null)
export function useSession(){const value=useContext(Context);if(!value)throw new Error('Session provider missing');return value}
export function SessionProvider({children}:{children:ReactNode}){
  const {signedAccountId:account,signNEP413Message}=useNearWallet();const [session,setSession]=useState<{account:string;token:string}|null>(null);const token=session?.account===account ? session.token : '';const [config,setConfig]=useState<ServerConfig|null>(null)
  const [configStatus,setConfigStatus]=useState<Session['configStatus']>('loading')
  const latestConfigRead = useRef(0)
  const refreshConfig=useCallback(async()=>{
    const read = ++latestConfigRead.current
    setConfigStatus('loading')
    try {
      const response=await fetch(`${API}/config`,{signal:AbortSignal.timeout(10000)})
      if(!response.ok)throw new Error('Could not refresh gateway configuration')
      const settings = await response.json() as ServerConfig
      if (read !== latestConfigRead.current) return
      setConfig(settings)
      setConfigStatus('ready')
    } catch {
      if (read !== latestConfigRead.current) return
      setConfig(null)
      setConfigStatus('unavailable')
    }
  },[])
  useEffect(()=>{void refreshConfig()},[refreshConfig])
  useEffect(()=>{setSession(previous=>previous?.account===account?previous:null)},[account])
  const request = useCallback(async <T = unknown,>(path:string,method='GET',body?:unknown,auth=token):Promise<T> => {
    const res=await fetch(`${API}${path}`,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(auth?{authorization:`Bearer ${auth}`}:{})},body:body?JSON.stringify(body):undefined})
    if(res.status===401 && auth && auth===token)setSession(current=>current?.token===auth?null:current)
    const data=await res.json().catch(error=>{
      if(res.ok)throw error
      return null
    })
    if(!res.ok)throw new Error(typeof data?.error==='string'?data.error:typeof data?.error?.message==='string'?data.error.message:`Gateway returned HTTP ${res.status}.`)
    return data as T
  }, [token])
  async function login(){
    if (!account) throw new Error('Connect a Testnet wallet first.')
    const c=await request<{id:string;message:string;recipient:string;nonce:string}>('/api/auth/challenge','POST');const signed=await signNEP413Message({message:c.message,recipient:c.recipient,nonce:fromBase64(c.nonce)})
    if(signed.accountId!==account)throw new Error('The signed wallet does not match the connected account.')
    const result=await request<{token:string}>('/api/auth/verify','POST',{challengeId:c.id,accountId:signed.accountId,publicKey:signed.publicKey,signature:signed.signature})
    setSession({account,token:result.token});return result.token as string
  }
  return <Context.Provider value={{token,config,configStatus,refreshConfig,login,request}}>{children}</Context.Provider>
}
