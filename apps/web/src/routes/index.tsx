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
  const [view, setView] = useState(() => window.location.hash === '#play' ? 'play' : window.location.hash === '#redeem' ? 'redeem' : 'arcade')
  useEffect(() => {
    const sync = () => setView(window.location.hash === '#play' ? 'play' : window.location.hash === '#redeem' ? 'redeem' : 'arcade')
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])
  return <main>
    <header><a className="brand" href="#arcade" aria-label="PromptPlay arcade">PromptPlay<span className="brand-dot">.</span></a>
      <nav aria-label="Main navigation"><a href="#arcade" aria-current={view === 'arcade' ? 'page' : undefined}>Arcade</a><a href="#redeem" aria-current={view === 'redeem' ? 'page' : undefined}>Inference</a></nav>
      <div className="header-actions"><span className="network"><i /> TESTNET</span>{(signedAccountId || view === 'arcade') && <Wallet />}</div>
    </header>
    {view === 'arcade' && <div className="lobby">
      <div className="lobby-heading"><div><span className="lobby-kicker">PROMPTPLAY ARCADE</span><h1>Play while you wait.</h1><p>Quick games. Shared credits.</p></div><span className="lobby-count">01 GAME</span></div>
      <section className="games" aria-labelledby="games-title"><div className="section-title"><h2 id="games-title">Games</h2><span>01</span></div>
        <a className="game-entry" href="#play"><div className="game-art" aria-hidden="true"><div className="hands"><span><img src="/hands/rock.svg" alt="" /></span><span><img src="/hands/paper.svg" alt="" /></span><span><img src="/hands/scissors.svg" alt="" /></span></div></div><div className="game-details"><div><span className="game-type">2 PLAYERS · PCC</span><h3>Rock Paper Scissors</h3><p>Challenge a friend</p></div><span className="play-link">Play <span aria-hidden="true">↗</span></span></div></a>
      </section>
    </div>}
    {view === 'play' && (signedAccountId ? <GameRoom /> : <section className="connect-page"><a className="back-link" href="#arcade">← Arcade</a><h1>Rock Paper Scissors</h1><p>Connect your wallet to play.</p><Wallet /></section>)}
    {view === 'redeem' && (signedAccountId ? <Redemption /> : <section className="connect-page"><a className="back-link" href="#arcade">← Arcade</a><h1>Inference</h1><p>Connect your wallet to continue.</p><Wallet /></section>)}
    <footer><span>PromptPlay · NEAR Testnet</span><a href={`https://testnet.nearblocks.io/address/${TOKEN}`} target="_blank" rel="noreferrer">PCC CONTRACT ↗</a></footer>
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
