export const GAME = 'game.ryanlau1220.testnet'
export const TOKEN = 'token.ryanlau1220.testnet'
export type Player = { account:string; funded:boolean; commitment:number[] | null; revealed:number | null; claim:string; pending:boolean }
export type Match = { id:string; stake:string; phase:'Funding'|'Committing'|'Revealing'|'Completed'|'Cancelled'; deadline:string; winner:string|null; players:[Player,Player] }
export type Secret = { choice:number; secret:string; commitment:string }
export const secretKey = (account:string, id:string) => `promptplay:testnet:${GAME}:${account}:${id}`
export function pcc(units:string) { const n = BigInt(units); const fraction = (n % 1000000n).toString().padStart(6,'0').replace(/0+$/, ''); return `${n / 1000000n}${fraction ? `.${fraction}` : ''}` }
export function amount(value:string) { if (!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(value)) throw new Error('Enter an amount with up to six decimal places.'); const [whole, fraction = ''] = value.split('.'); const n = BigInt(whole!) * 1000000n + BigInt(fraction.padEnd(6,'0')); if (n <= 0n || n > (2n ** 127n - 1n)) throw new Error('Enter a valid stake.'); return n.toString() }
export function confirmStakeTransfer(result: unknown, stake: string) {
  if (typeof result !== 'string' || !/^\d+$/.test(result)) throw new Error('Deposit result is uncertain. Refresh the match and check the transaction before retrying.')
  if (BigInt(result) !== BigInt(stake)) throw new Error('The game did not accept the full stake. Check the transaction and refresh the match before retrying.')
}
export function base64(bytes:Uint8Array) { return btoa(String.fromCharCode(...bytes)) }
export function fromBase64(value:string) { return Uint8Array.from(atob(value), char => char.charCodeAt(0)) }
export async function commitment(account:string, matchId:string, choice:number, secret:Uint8Array) {
  if (!/^\d+$/.test(matchId) || BigInt(matchId) > 2n**64n - 1n || !Number.isInteger(choice) || choice < 0 || choice > 2 || secret.length !== 32) throw new Error('Invalid move.')
  const encoder = new TextEncoder(); const parts = [encoder.encode(GAME), encoder.encode(account)]
  const domain = encoder.encode('PromptPlay:RPS:v1'); const size = domain.length + parts.reduce((n,p)=>n+4+p.length,0) + 8 + 4 + 1 + 32
  const data = new Uint8Array(size); const view = new DataView(data.buffer); let pos = 0
  data.set(domain,pos); pos += domain.length
  for (const part of parts) { view.setUint32(pos,part.length,true); pos += 4; data.set(part,pos); pos += part.length }
  view.setBigUint64(pos,BigInt(matchId),true); pos += 8; view.setUint32(pos,1,true); pos += 4; data[pos++] = choice; data.set(secret,pos)
  return base64(new Uint8Array(await crypto.subtle.digest('SHA-256',data)))
}
