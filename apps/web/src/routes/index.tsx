import { createFileRoute } from '@tanstack/react-router'
import { NearProvider, useNearWallet } from 'near-connect-hooks'
import { useEffect, useState } from 'react'
import { GameRoom } from '../components/GameRoom'
import { Redemption } from '../components/Redemption'
import { SessionProvider } from '../components/Session'
import { TOKEN } from '../lib/game'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  return mounted ? <NearProvider config={{ network: 'testnet' }}><SessionProvider><Content /></SessionProvider></NearProvider> : <main><header><a className="brand" href="/">PromptPlay</a></header></main>
}

function Content() {
  const { signedAccountId } = useNearWallet()
  return <main>
    <header><a className="brand" href="/" aria-label="PromptPlay home">PromptPlay</a><div className="header-actions"><span className="network"><i /> NEAR TESTNET</span>{signedAccountId && <Wallet />}</div></header>
    {!signedAccountId && <section className="hero">
      <div className="hands" aria-hidden="true"><span><img src="/hands/rock.svg" alt="" /></span><span><img src="/hands/paper.svg" alt="" /></span><span><img src="/hands/scissors.svg" alt="" /></span></div>
      <h1>Rock Paper Scissors</h1>
      <p>Play a friend. Win PCC.</p>
      <Wallet />
      <small>NEAR Testnet</small>
    </section>}
    {signedAccountId && <><GameRoom /><Redemption /></>}
    <footer><span>PromptPlay · NEAR Testnet</span><a href={`https://testnet.nearblocks.io/address/${TOKEN}`} target="_blank" rel="noreferrer">VIEW PCC CONTRACT ↗</a></footer>
  </main>
}

function Wallet() {
  const { signedAccountId, loading, signIn, signOut, viewFunction } = useNearWallet()
  const [balance, setBalance] = useState<string | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    if (!signedAccountId) { setBalance(null); return }
    function readBalance() {
      viewFunction({contractId:TOKEN, method:'ft_balance_of', args:{account_id:signedAccountId}})
        .then((result: unknown) => { if (active) { const units = BigInt(String(result)); setBalance(`${units / 1000000n}.${(units % 1000000n).toString().padStart(6, '0').replace(/0+$/, '') || '0'}`) } })
        .catch(() => { if (active) setError('Could not load PCC balance.') })
    }
    readBalance(); window.addEventListener('promptplay:balance',readBalance); const timer=window.setInterval(readBalance,15000)
    return () => { active = false;window.removeEventListener('promptplay:balance',readBalance);clearInterval(timer) }
  }, [signedAccountId, viewFunction])
  async function connect() { try { setError(''); await signIn() } catch { setError('Wallet connection was not completed.') } }
  async function disconnect() { try { setError(''); await signOut() } catch { setError('Could not disconnect the wallet.') } }
  return <div className="wallet-area">
    {signedAccountId ? <div className="connected"><div><strong>{signedAccountId}</strong><small>{balance === null ? 'Loading balance…' : `${balance} PCC`}</small></div><button className="text-button" onClick={disconnect}>Disconnect</button></div> : <button className="primary" onClick={connect} disabled={loading}>{loading ? 'Connecting…' : 'Connect wallet'} <span>↗</span></button>}
    {error && <p className="error" role="alert">{error}</p>}
  </div>
}
