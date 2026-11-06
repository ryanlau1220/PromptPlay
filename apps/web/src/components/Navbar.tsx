import { useNearWallet } from 'near-connect-hooks'
import { useEffect, useState } from 'react'
import { Moon, Sun, Terminal, Gamepad2, Cpu, Wallet as WalletIcon, LogOut } from 'lucide-react'
import { TOKEN } from '../lib/game'
import { Brand } from './Brand'

type NavbarProps = {
  view: string
  theme: 'light' | 'dark'
  onToggleTheme: () => void
}

export function Navbar({ view, theme, onToggleTheme }: NavbarProps) {
  const { signedAccountId, loading, signIn, signOut, viewFunction } = useNearWallet()
  const [balance, setBalance] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    if (!signedAccountId) {
      setBalance(null)
      return
    }

    function readBalance() {
      viewFunction({ contractId: TOKEN, method: 'ft_balance_of', args: { account_id: signedAccountId } })
        .then((result: unknown) => {
          if (active) {
            const units = BigInt(String(result))
            const whole = units / 1000000n
            const fraction = (units % 1000000n).toString().padStart(6, '0').replace(/0+$/, '')
            setBalance(`${whole}${fraction ? `.${fraction}` : ''}`)
            setError('')
          }
        })
        .catch(() => {
          if (active) setError('Could not load PCC balance')
        })
    }

    readBalance()
    window.addEventListener('promptplay:balance', readBalance)
    const timer = window.setInterval(readBalance, 30000)
    return () => {
      active = false
      window.removeEventListener('promptplay:balance', readBalance)
      clearInterval(timer)
    }
  }, [signedAccountId, viewFunction])

  async function connect() {
    try {
      setError('')
      await signIn()
    } catch {
      setError('Connection failed')
    }
  }

  async function disconnect() {
    try {
      setError('')
      await signOut()
    } catch {
      setError('Disconnect failed')
    }
  }

  return (
    <header className="app-header">
      <div className="brand-wrapper">
        <a href="#arcade" aria-label="PromptPlay Homepage">
          <Brand />
        </a>
      </div>

      <nav className="app-nav" aria-label="Main Navigation">
        <a href="#arcade" aria-current={view === 'arcade' ? 'page' : undefined}>
          <Gamepad2 size={15} />
          <span>Arcade</span>
        </a>
        <a href="#play" aria-current={view === 'play' ? 'page' : undefined}>
          <Terminal size={15} />
          <span>Duel Arena</span>
        </a>
        <a href="#redeem" className="nav-accent" aria-current={view === 'redeem' ? 'page' : undefined}>
          <Cpu size={15} />
          <span>Inference Hub</span>
        </a>
      </nav>

      <div className="header-right">
        <div className="network-badge" title="Connected to NEAR Testnet RPC">
          <i />
          <span>TESTNET</span>
        </div>

        <button
          className="theme-toggle-btn"
          type="button"
          onClick={onToggleTheme}
          aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          title={theme === 'light' ? 'Dark Mode' : 'Light Mode'}
        >
          {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
        </button>

        <div className="wallet-box">
          {signedAccountId ? (
            <div className="wallet-connected-pill">
              <span className="wallet-account-id" title={signedAccountId}>
                {signedAccountId}
              </span>
              <div className="wallet-balance-chip" title="PromptPlay Compute Credits">
                <span>{balance === null ? '…' : balance}</span>
                <small>PCC</small>
              </div>
              <button
                className="btn-disconnect"
                type="button"
                onClick={disconnect}
                title="Disconnect wallet"
              >
                <LogOut size={14} />
              </button>
            </div>
          ) : (
            <button
              className="btn-primary"
              type="button"
              onClick={connect}
              disabled={loading}
            >
              <WalletIcon size={16} />
              <span>{loading ? 'Connecting…' : 'Connect Wallet'}</span>
            </button>
          )}
        </div>
      </div>
      {error && <span className="wallet-error" role="alert">{error}</span>}
    </header>
  )
}
