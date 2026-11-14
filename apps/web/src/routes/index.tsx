import { createFileRoute } from '@tanstack/react-router'
import { NearProvider, useNearWallet } from 'near-connect-hooks'
import { lazy, Suspense, useEffect, useState } from 'react'
import { Navbar } from '../components/Navbar'
import { Brand } from '../components/Brand'
import { SessionProvider } from '../components/Session'
import { GAME, TOKEN } from '../lib/game'
import { Gamepad2, Cpu, ExternalLink } from 'lucide-react'

const ComputeDemo = lazy(() => import('../components/ComputeDemo').then((m) => ({ default: m.ComputeDemo })))
const ArcadeLobby = lazy(() => import('../components/ArcadeLobby').then((m) => ({ default: m.ArcadeLobby })))
const GameRoom = lazy(() => import('../components/GameRoom').then((m) => ({ default: m.GameRoom })))
const PracticeArcade = lazy(() => import('../components/practice/PracticeArcade').then((m) => ({ default: m.PracticeArcade })))
const ArcadeSettlement = lazy(() => import('../components/ArcadeSettlement').then((m) => ({ default: m.ArcadeSettlement })))
const Redemption = lazy(() => import('../components/Redemption').then((m) => ({ default: m.Redemption })))

const nearConfig = {
  network: 'testnet' as const,
  providers: {
    testnet: [import.meta.env.VITE_NEAR_RPC_URL || 'https://rpc.testnet.fastnear.com']
  }
}

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  return mounted ? (
    <NearProvider config={nearConfig}>
      <SessionProvider>
        <Content />
      </SessionProvider>
    </NearProvider>
  ) : (
    <main className="app-shell">
      <header className="app-header">
        <Brand />
      </header>
    </main>
  )
}

function Content() {
  const { signedAccountId, signIn, loading } = useNearWallet()
  const [walletError, setWalletError] = useState('')
  async function connectWallet() {
    setWalletError('')
    try { await signIn() } catch { setWalletError('Wallet connection was not completed.') }
  }

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem('promptplay:theme')
      if (saved === 'light' || saved === 'dark') return saved
    } catch {
      /* Fallback to dark theme as default for cyber-arcade aesthetic */
    }
    return 'dark'
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem('promptplay:theme', theme)
    } catch {
      /* Session fallback */
    }
  }, [theme])

  const [hash, setHash] = useState(() => window.location.hash)
  const view = hash === '#compute-demo' ? 'demo' : hash === '#play' ? 'play' : hash === '#redeem' ? 'redeem' : hash.startsWith('#practice/') ? 'practice' : hash.startsWith('#arcade-duel') ? 'settlement' : 'arcade'

  useEffect(() => {
    const sync = () => {
      const next = window.location.hash
      setWalletError('')
      setHash(next)
      if (next !== '#games' && next !== '#loop') {
        window.scrollTo({ top: 0, behavior: 'instant' })
      }
    }
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  return (
    <main className="app-shell">
      <div className="cyber-grid-bg" />

      <Navbar
        view={view === 'practice' || view === 'settlement' || view === 'demo' ? 'arcade' : view}
        theme={theme}
        onToggleTheme={() => setTheme(theme === 'light' ? 'dark' : 'light')}
      />

      <Suspense fallback={<output className="arena-container">Loading arcade…</output>}>
      {view === 'arcade' && <ArcadeLobby />}
      {view === 'demo' && <ComputeDemo />}
      {view === 'practice' && <PracticeArcade id={hash.slice('#practice/'.length)} />}
      {view === 'settlement' && (signedAccountId ? <ArcadeSettlement hash={hash} /> : <div className="arena-container"><button type="button" className="btn-primary" onClick={() => void connectWallet()} disabled={loading}>Connect NEAR Wallet</button></div>)}

      {view === 'play' &&
        (signedAccountId ? (
          <GameRoom key={signedAccountId} />
        ) : (
          <div className="arena-container" style={{ textAlign: 'center', padding: '80px 0' }}>
            <div className="terminal-card" style={{ maxWidth: '440px', margin: '0 auto' }}>
              <Gamepad2 size={44} color="var(--cyan)" style={{ margin: '0 auto 16px' }} />
              <h2 style={{ fontFamily: 'var(--font-display)', margin: '0 0 20px' }}>
                Enter Duel Arena
              </h2>
              <p>Play first to two round wins with another Testnet wallet.</p>
              <button type="button" className="btn-primary" onClick={() => void connectWallet()} disabled={loading} style={{ width: '100%' }}>
                <span>{loading ? 'Connecting wallet…' : 'Connect NEAR Wallet'}</span>
              </button>
            </div>
          </div>
        ))}

      {view === 'redeem' &&
        (signedAccountId ? (
          <Redemption key={signedAccountId} />
        ) : (
          <div className="arena-container" style={{ textAlign: 'center', padding: '80px 0' }}>
            <div className="terminal-card" style={{ maxWidth: '440px', margin: '0 auto' }}>
              <Cpu size={44} color="var(--crimson)" style={{ margin: '0 auto 16px' }} />
              <h2 style={{ fontFamily: 'var(--font-display)', margin: '0 0 20px' }}>
                Inference Terminal
              </h2>
              <p>Sign in with your Testnet wallet to view your allowance and check redemption access.</p>
              <button type="button" className="btn-accent" onClick={() => void connectWallet()} disabled={loading} style={{ width: '100%' }}>
                <span>{loading ? 'Connecting wallet…' : 'Connect NEAR Wallet'}</span>
              </button>
            </div>
          </div>
        ))}

      </Suspense>

      {walletError && <div className="status-toast" role="alert">{walletError}</div>}

      <footer className="app-footer">
        <div>
          <strong>PromptPlay Arcade</strong> · NEAR Hackathon 2026 (Track #09: Games With Real Economies)
        </div>

        <div className="footer-links">
          <a href={`https://testnet.nearblocks.io/address/${TOKEN}`} target="_blank" rel="noreferrer">
            <span>PCC Token Contract</span>
            <ExternalLink size={11} style={{ display: 'inline', marginLeft: '3px' }} />
          </a>
          <a href={`https://testnet.nearblocks.io/address/${GAME}`} target="_blank" rel="noreferrer">
            <span>RPS Game Contract</span>
            <ExternalLink size={11} style={{ display: 'inline', marginLeft: '3px' }} />
          </a>
          <a href="https://nearhackathon.com/" target="_blank" rel="noreferrer">
            <span>NEAR Hackathon 2026</span>
          </a>
        </div>
      </footer>
    </main>
  )
}
