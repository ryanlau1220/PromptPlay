import { useNearWallet } from 'near-connect-hooks'
import { getTransactionLastResult } from 'near-api-js'
import { useCallback, useEffect, useRef, useState } from 'react'
import { amount, confirmStakeTransfer, pcc, TOKEN } from '../lib/game'
import { isGameId, practiceGames } from './practice/games'

const CONTRACT = 'arcade.ryanlau1220.testnet'
type Outcome = 'PlayerOne' | 'PlayerTwo' | 'Tie'
type Match = {
  id: string
  game: string
  stake: string
  phase: 'Funding' | 'Agreement' | 'Completed' | 'Cancelled'
  deadline: string
  outcome: Outcome | null
  players: [
    { account: string; funded: boolean; vote: Outcome | null; claim: string; pending: boolean },
    { account: string; funded: boolean; vote: Outcome | null; claim: string; pending: boolean },
  ]
}
export function ArcadeSettlement({ hash }: { hash: string }) {
  const { signedAccountId: account, viewFunction, callFunctionRaw } = useNearWallet()
  const params = new URLSearchParams(hash.split('?')[1] ?? ''),
    matchId = params.get('match') ?? '',
    gameId = params.get('game') ?? ''
  const [opponent, setOpponent] = useState(''),
    [stake, setStake] = useState('1'),
    [join, setJoin] = useState(''),
    [match, setMatch] = useState<Match | null>(null),
    [pending, setPending] = useState(false),
    [message, setMessage] = useState(''),
    [txHash, setTxHash] = useState(''),
    [registered, setRegistered] = useState<boolean | null>(null),
    [now, setNow] = useState(Date.now())
  const running = useRef(false),
    funded = useRef('')
  const validId = /^\d{1,20}$/.test(matchId) && BigInt(matchId) <= 2n ** 64n - 1n
  const checkRegistration = useCallback(async () => {
    const storage = await viewFunction({
      contractId: TOKEN,
      method: 'storage_balance_of',
      args: { account_id: account },
    })
    setRegistered(storage !== null)
  }, [account, viewFunction])
  useEffect(() => {
    setRegistered(null)
    void checkRegistration().catch(() => setMessage('Could not check PCC registration.'))
  }, [checkRegistration])
  const refresh = useCallback(async () => {
    if (!validId) {
      setMatch(null)
      return
    }
    const result = (await viewFunction({
      contractId: CONTRACT,
      method: 'get_match',
      args: { match_id: matchId },
    })) as Match | null
    setMatch(result?.id === matchId ? result : null)
  }, [matchId, validId, viewFunction])
  useEffect(() => {
    void refresh().catch(() => setMessage('Could not load the match.'))
    const timer = window.setInterval(() => {
      setNow(Date.now())
      void refresh().catch(() => {})
    }, 5000)
    return () => window.clearInterval(timer)
  }, [refresh])
  async function call(
    contractId: string,
    method: string,
    args: Record<string, unknown>,
    deposit: string,
  ): Promise<unknown> {
    const result = await callFunctionRaw({ contractId, method, args, gas: '100000000000000', deposit }).catch(() => {
      throw new Error('Wallet did not return a transaction result. Check wallet history and refresh the match before retrying.')
    })
    if (result.transaction?.hash) setTxHash(result.transaction.hash)
    if (result.status && typeof result.status === 'object' && 'Failure' in result.status) {
      throw new Error('Testnet reported a failed transaction. Check the explorer and refresh the match before retrying.')
    }
    if (!result.status || typeof result.status !== 'object' || !('SuccessValue' in result.status))
      throw new Error('Transaction not confirmed. Check wallet history before retrying.')
    return getTransactionLastResult(result)
  }
  async function action(fn: () => Promise<void>) {
    if (running.current) return
    running.current = true
    setPending(true)
    setTxHash('')
    setMessage('Confirm in your wallet…')
    let confirmed = false
    try {
      await fn()
      confirmed = true
      setMessage('Transaction confirmed.')
      window.dispatchEvent(new Event('promptplay:balance'))
      await refresh()
    } catch (error) {
      setMessage(
        confirmed
          ? 'Transaction confirmed, but refresh failed. Check the explorer before retrying.'
          : error instanceof Error
            ? error.message
            : 'Transaction could not be completed.',
      )
    } finally {
      running.current = false
      setPending(false)
    }
  }
  function open(id: string) {
    if (!/^\d{1,20}$/.test(id) || BigInt(id) > 2n ** 64n - 1n) throw new Error('Enter a valid match ID.')
    window.location.hash = `arcade-duel?match=${id}`
  }
  const me = match?.players.find((p) => p.account === account),
    expired = !!match && now >= Number(BigInt(match.deadline) / 1000000n)
  const title = practiceGames.find((game) => game.id === (match?.game ?? gameId))?.name ?? match?.game ?? 'Arcade match'
  return (
    <section className="arena-container">
      <a href={isGameId(gameId) ? `#practice/${gameId}` : '#games'} className="back-btn">
        ← Arcade
      </a>
      <h1>{title}</h1>
      {registered === false && (
        <button
          type="button"
          className="btn-ghost"
          disabled={pending}
          onClick={() =>
            void action(async () => {
              await call(
                TOKEN,
                'storage_deposit',
                { account_id: account, registration_only: true },
                '1250000000000000000000',
              )
              await checkRegistration()
            })
          }
        >
          Register PCC storage · 0.00125 NEAR
        </button>
      )}
      <p>
        Practice is solo. Both wallets must agree; results are not verified on-chain. Disagreements refund after the
        deadline.
      </p>
      {!matchId && (
        <div className="settlement-panel">
          <h3>Create match</h3>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void action(async () => {
                if (!isGameId(gameId)) throw new Error('Choose a game first.')
                const id = await call(
                  CONTRACT,
                  'create_match',
                  { game: gameId, opponent, stake: amount(stake) },
                  '10000000000000000000000',
                )
                open(String(id))
              })
            }}
          >
            <label className="field-label">
              <span>Opponent</span>
              <input
                className="input-field"
                value={opponent}
                onChange={(e) => setOpponent(e.target.value)}
                required
                placeholder="friend.testnet"
              />
            </label>
            <label className="field-label">
              <span>Stake (PCC)</span>
              <input
                className="input-field"
                value={stake}
                onChange={(e) => setStake(e.target.value)}
                required
                inputMode="decimal"
              />
            </label>
            <button type="submit" className="btn-primary" disabled={pending}>
              Create match
            </button>
          </form>
          <label className="field-label">
            <span>Join match ID</span>
            <input className="input-field" value={join} onChange={(e) => setJoin(e.target.value)} inputMode="numeric" />
          </label>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              try {
                open(join)
              } catch (error) {
                setMessage(error instanceof Error ? error.message : 'Invalid match ID')
              }
            }}
          >
            Open match
          </button>
        </div>
      )}
      {matchId && !match && <p>Match unavailable or still loading.</p>}
      {match && (
        <div className="settlement-panel">
          <h3>
            Match {match.id} · {match.phase}
          </h3>
          <p>
            {pcc(match.stake)} PCC each
            {(match.phase === 'Funding' || match.phase === 'Agreement') &&
              ` · ${expired ? 'Deadline reached' : `Deadline ${new Date(Number(BigInt(match.deadline) / 1000000n)).toLocaleString()}`}`}
          </p>
          <p>
            {match.players[0].account} vs {match.players[1].account}
          </p>
          {match.phase === 'Completed' && (
            <p>
              Result:{' '}
              {match.outcome === 'Tie' ? 'Tie' : `${match.players[match.outcome === 'PlayerOne' ? 0 : 1].account} wins`}
            </p>
          )}
          {(match.phase === 'Funding' || match.phase === 'Agreement') && (
            <button
              type="button"
              className="btn-ghost"
              onClick={() =>
                void navigator.clipboard
                  .writeText(window.location.href)
                  .then(() => setMessage('Match link copied.'))
                  .catch(() => setMessage('Could not copy link.'))
              }
            >
              Copy invite
            </button>
          )}
          {me && match.phase === 'Funding' && !me.funded && !expired && (
            <button
              type="button"
              className="btn-primary"
              disabled={pending || funded.current === `${account}:${match.id}`}
              onClick={() =>
                void action(async () => {
                  const result = await call(
                    TOKEN,
                    'ft_transfer_call',
                    { receiver_id: CONTRACT, amount: match.stake, memo: null, msg: match.id },
                    '1',
                  )
                  confirmStakeTransfer(result, match.stake)
                  funded.current = `${account}:${match.id}`
                })
              }
            >
              Deposit {pcc(match.stake)} PCC
            </button>
          )}
          {me && match.phase === 'Agreement' && !expired && (
            <div>
              <p>
                Your vote: {me.vote ?? 'not submitted'} · Other vote:{' '}
                {match.players.find((p) => p.account !== account)?.vote ?? 'not submitted'}
              </p>
              {(['PlayerOne', 'PlayerTwo', 'Tie'] as const).map((result) => (
                <button
                  type="button"
                  className="btn-ghost"
                  key={result}
                  disabled={pending}
                  onClick={() =>
                    void action(async () => {
                      await call(CONTRACT, 'agree_result', { match_id: match.id, outcome: result }, '0')
                    })
                  }
                >
                  {result === 'Tie'
                    ? 'Agree tie'
                    : `Agree ${match.players[result === 'PlayerOne' ? 0 : 1].account} wins`}
                </button>
              ))}
            </div>
          )}
          {expired && (match.phase === 'Funding' || match.phase === 'Agreement') && (
            <button
              type="button"
              className="btn-ghost"
              disabled={pending}
              onClick={() =>
                void action(async () => {
                  await call(CONTRACT, 'resolve_timeout', { match_id: match.id }, '0')
                })
              }
            >
              Resolve timeout
            </button>
          )}
          {me && BigInt(me.claim) > 0n && (
            <button
              type="button"
              className="btn-primary"
              disabled={pending || me.pending}
              onClick={() =>
                void action(async () => {
                  if ((await call(CONTRACT, 'claim_payout', { match_id: match.id }, '1')) !== true)
                    throw new Error('Payout failed; claim remains available for retry.')
                })
              }
            >
              Claim {pcc(me.claim)} PCC
            </button>
          )}
        </div>
      )}
      {message && (
        <output className="status-toast">
          {message}
          {txHash && (
            <a href={`https://testnet.nearblocks.io/txns/${txHash}`} target="_blank" rel="noreferrer">
              {' '}
              Explorer ↗
            </a>
          )}
        </output>
      )}
    </section>
  )
}
