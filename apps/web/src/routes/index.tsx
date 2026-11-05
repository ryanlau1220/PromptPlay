import { createFileRoute } from '@tanstack/react-router'
import { NearProvider, useNearWallet } from 'near-connect-hooks'
import { useEffect, useState } from 'react'
import { GameRoom } from '../components/GameRoom'
import { TOKEN } from '../lib/game'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  return mounted ? <NearProvider config={{ network: 'testnet' }}><Content /></NearProvider> : <main><header><a className="brand" href="/">PromptPlay</a></header></main>
}

function Content() {
  const { signedAccountId } = useNearWallet()
  return <main>
    <header><a className="brand" href="/" aria-label="PromptPlay home"><span className="brand-mark">P<span>✳</span></span> PromptPlay</a><span className="network"><i /> NEAR TESTNET</span></header>
    <div className="hero">
      <section className="intro">
        <h1>While your<br />agent works,<br /><em>play.</em></h1>
        <p className="lede">A quick game of rock, paper, scissors. Real players, verifiable moves, and credits that keep moving.</p>
        <Wallet />
        <p className="note">Testnet demo credits</p>
      </section>
      <aside className="arena" aria-label="Rock paper scissors game preview">
        <div className="orbit"><div className="hand">ROCK</div><span className="vs">VS</span><div className="hand second">SCISSORS</div></div>
      </aside>
    </div>
    {signedAccountId && <GameRoom />}
    <footer><span>BUILT FOR THE WAIT.</span><a href={`https://testnet.nearblocks.io/address/${TOKEN}`} target="_blank" rel="noreferrer">VIEW PCC CONTRACT ↗</a></footer>
  </main>
}

function Wallet() {
  const { signedAccountId, loading, signIn, signOut, viewFunction } = useNearWallet()
  const [balance, setBalance] = useState<string | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    if (!signedAccountId) { setBalance(null); return }
    viewFunction({contractId:TOKEN, method:'ft_balance_of', args:{account_id:signedAccountId}})
      .then((result: unknown) => { if (active) { const units = BigInt(String(result)); setBalance(`${units / 1000000n}.${(units % 1000000n).toString().padStart(6, '0').replace(/0+$/, '') || '0'}`) } })
      .catch(() => { if (active) setError('Could not load PCC balance.') })
    return () => { active = false }
  }, [signedAccountId, viewFunction])
  async function connect() { try { setError(''); await signIn() } catch { setError('Wallet connection was not completed.') } }
  async function disconnect() { try { setError(''); await signOut() } catch { setError('Could not disconnect the wallet.') } }
  return <div className="wallet-area">
    {signedAccountId ? <div className="connected"><div><span>CONNECTED WALLET</span><strong>{signedAccountId}</strong><small>{balance === null ? 'Loading balance…' : `${balance} PCC`}</small></div><button className="text-button" onClick={disconnect}>Disconnect</button></div> : <button className="primary" onClick={connect} disabled={loading}>{loading ? 'Connecting…' : 'Connect wallet'} <span>↗</span></button>}
    {error && <p className="error" role="alert">{error}</p>}
  </div>
}
