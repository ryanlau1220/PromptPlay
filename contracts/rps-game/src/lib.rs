use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_sdk::collections::LookupMap;
use near_sdk::json_types::{Base64VecU8, U64, U128};
use near_sdk::{
    AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue, env, ext_contract, near,
    require,
};

const PHASE_NS: u64 = 300_000_000_000;
const STORAGE_DEPOSIT: NearToken = NearToken::from_millinear(10);

#[near(serializers = [json, borsh])]
#[derive(Clone, PartialEq, Eq)]
pub enum Phase {
    Funding,
    Committing,
    Revealing,
    Completed,
    Cancelled,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Player {
    account: AccountId,
    funded: bool,
    commitment: Option<[u8; 32]>,
    revealed: Option<u8>,
    claim: U128,
    pending: bool,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Match {
    id: U64,
    stake: U128,
    players: [Player; 2],
    phase: Phase,
    deadline: U64,
    winner: Option<AccountId>,
    round: u32,
    wins: [u8; 2],
}

#[ext_contract(ext_ft)]
#[allow(dead_code)]
trait Token {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}
#[ext_contract(ext_self)]
#[allow(dead_code)]
trait Callback {
    fn on_payout(&mut self, match_id: U64, player: u8, amount: U128) -> bool;
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    token: AccountId,
    next_id: u64,
    matches: LookupMap<u64, Match>,
}

fn player(account: AccountId) -> Player {
    Player {
        account,
        funded: false,
        commitment: None,
        revealed: None,
        claim: U128(0),
        pending: false,
    }
}
fn index(m: &Match, account: &AccountId) -> usize {
    m.players
        .iter()
        .position(|p| &p.account == account)
        .unwrap_or_else(|| env::panic_str("Not a player"))
}
fn deadline() -> U64 {
    U64(env::block_timestamp()
        .checked_add(PHASE_NS)
        .expect("Timestamp overflow"))
}
fn emit(event: &str, m: &Match) {
    let mut key = b"events:".to_vec();
    key.extend_from_slice(&m.id.0.to_le_bytes());
    let previous = env::storage_read(&key)
        .map(|bytes| u64::from_le_bytes(bytes.try_into().expect("Invalid event sequence")))
        .unwrap_or(0);
    let sequence = previous.checked_add(1).expect("Event sequence exhausted");
    env::storage_write(&key, &sequence.to_le_bytes());
    env::log_str(&format!(
        "EVENT_JSON:{}",
        near_sdk::serde_json::json!({
            "standard": "promptplay_rps", "version": "1.0.0", "event": event,
            "data": [{"sequence": U64(sequence), "match": m}]
        })
    ));
}
fn refund(m: &mut Match) {
    for p in &mut m.players {
        if p.funded {
            p.claim = m.stake;
        }
    }
    m.phase = Phase::Cancelled;
}
fn award(m: &mut Match, winner: usize) {
    m.players[winner].claim = U128(m.stake.0.checked_mul(2).expect("Stake overflow"));
    m.winner = Some(m.players[winner].account.clone());
    m.phase = Phase::Completed;
}

#[near]
impl Contract {
    #[init]
    pub fn new(token: AccountId) -> Self {
        Self {
            token,
            next_id: 0,
            matches: LookupMap::new(b"m"),
        }
    }

    /// The caller funds permanent match storage; the opponent is fixed before deposits.
    #[payable]
    pub fn create_match(&mut self, opponent: AccountId, stake: U128) -> U64 {
        let caller = env::predecessor_account_id();
        require!(
            env::attached_deposit() >= STORAGE_DEPOSIT,
            "Insufficient storage deposit"
        );
        require!(caller != opponent, "Players must differ");
        require!(stake.0 > 0 && stake.0 <= u128::MAX / 2, "Invalid stake");
        let id = self.next_id;
        self.next_id = id.checked_add(1).expect("Match IDs exhausted");
        let game = Match {
            id: U64(id),
            stake,
            players: [player(caller), player(opponent)],
            phase: Phase::Funding,
            deadline: deadline(),
            winner: None,
            round: 1,
            wins: [0, 0],
        };
        self.matches.insert(&id, &game);
        emit("match_created", &game);
        U64(id)
    }

    pub fn get_match(&self, match_id: U64) -> Option<Match> {
        self.matches.get(&match_id.0)
    }

    pub fn get_match_count(&self) -> U64 {
        U64(self.next_id)
    }

    pub fn commit_move(&mut self, match_id: U64, commitment: Base64VecU8) {
        let mut m = self.matches.get(&match_id.0).expect("Unknown match");
        require!(
            m.phase == Phase::Committing && env::block_timestamp() < m.deadline.0,
            "Commit phase closed"
        );
        let i = index(&m, &env::predecessor_account_id());
        require!(m.players[i].commitment.is_none(), "Already committed");
        m.players[i].commitment = Some(
            commitment
                .0
                .try_into()
                .unwrap_or_else(|_| env::panic_str("Expected 32-byte hash")),
        );
        if m.players.iter().all(|p| p.commitment.is_some()) {
            m.phase = Phase::Revealing;
            m.deadline = deadline();
        }
        self.matches.insert(&match_id.0, &m);
        emit("move_committed", &m);
    }

    /// SHA-256 of domain, length-prefixed contract and account IDs, match ID (LE u64), round (LE u32), move and 32-byte secret.
    pub fn reveal_move(&mut self, match_id: U64, choice: u8, secret: Base64VecU8) {
        let mut m = self.matches.get(&match_id.0).expect("Unknown match");
        require!(
            m.phase == Phase::Revealing && env::block_timestamp() < m.deadline.0,
            "Reveal phase closed"
        );
        require!(choice < 3 && secret.0.len() == 32, "Invalid reveal");
        let account = env::predecessor_account_id();
        let i = index(&m, &account);
        require!(m.players[i].revealed.is_none(), "Already revealed");
        let mut bytes = b"PromptPlay:RPS:v1".to_vec();
        for part in [env::current_account_id().as_bytes(), account.as_bytes()] {
            bytes.extend_from_slice(&(part.len() as u32).to_le_bytes());
            bytes.extend_from_slice(part);
        }
        bytes.extend_from_slice(&match_id.0.to_le_bytes());
        bytes.extend_from_slice(&m.round.to_le_bytes());
        bytes.push(choice);
        bytes.extend_from_slice(&secret.0);
        require!(
            m.players[i].commitment.as_ref().map(|h| h.as_slice())
                == Some(env::sha256(&bytes).as_slice()),
            "Commitment mismatch"
        );
        m.players[i].revealed = Some(choice);
        emit("move_revealed", &m);
        if let (Some(a), Some(b)) = (m.players[0].revealed, m.players[1].revealed) {
            if a != b {
                let winner = if (a + 3 - b) % 3 == 1 { 0 } else { 1 };
                m.wins[winner] += 1;
                if m.wins[winner] == 2 {
                    award(&mut m, winner);
                }
            }
            emit("round_resolved", &m);
            if m.phase != Phase::Completed {
                m.round = m.round.checked_add(1).expect("Rounds exhausted");
                for player in &mut m.players {
                    player.commitment = None;
                    player.revealed = None;
                }
                m.phase = Phase::Committing;
                m.deadline = deadline();
                emit("round_started", &m);
            } else {
                emit("match_resolved", &m);
            }
        }
        self.matches.insert(&match_id.0, &m);
    }

    pub fn resolve_timeout(&mut self, match_id: U64) {
        let mut m = self.matches.get(&match_id.0).expect("Unknown match");
        require!(
            env::block_timestamp() >= m.deadline.0,
            "Deadline not reached"
        );
        match m.phase {
            Phase::Funding | Phase::Committing => refund(&mut m),
            Phase::Revealing => match (
                m.players[0].revealed.is_some(),
                m.players[1].revealed.is_some(),
            ) {
                (true, false) => award(&mut m, 0),
                (false, true) => award(&mut m, 1),
                _ => refund(&mut m),
            },
            _ => env::panic_str("Match already resolved"),
        }
        self.matches.insert(&match_id.0, &m);
        emit("timeout_resolved", &m);
    }

    #[payable]
    pub fn claim_payout(&mut self, match_id: U64) -> Promise {
        near_sdk::assert_one_yocto();
        let mut m = self.matches.get(&match_id.0).expect("Unknown match");
        let i = index(&m, &env::predecessor_account_id());
        require!(
            !m.players[i].pending && m.players[i].claim.0 > 0,
            "Nothing claimable"
        );
        let amount = m.players[i].claim;
        m.players[i].claim = U128(0);
        m.players[i].pending = true;
        let recipient = m.players[i].account.clone();
        self.matches.insert(&match_id.0, &m);
        emit("payout_started", &m);
        ext_ft::ext(self.token.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(Gas::from_tgas(15))
            .ft_transfer(recipient, amount, Some("PromptPlay payout".into()))
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(10))
                    .on_payout(match_id, i as u8, amount),
            )
    }

    #[private]
    pub fn on_payout(&mut self, match_id: U64, player: u8, amount: U128) -> bool {
        let mut m = self.matches.get(&match_id.0).expect("Unknown match");
        let p = &mut m.players[player as usize];
        require!(p.pending, "No payout pending");
        let success = env::promise_result_checked(0, 0).is_ok();
        p.pending = false;
        if !success {
            p.claim = amount;
        }
        self.matches.insert(&match_id.0, &m);
        emit(
            if success {
                "payout_succeeded"
            } else {
                "payout_failed"
            },
            &m,
        );
        success
    }
}

#[near]
impl FungibleTokenReceiver for Contract {
    fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        if env::predecessor_account_id() != self.token {
            return PromiseOrValue::Value(amount);
        }
        let Ok(id) = msg.parse::<u64>() else {
            return PromiseOrValue::Value(amount);
        };
        let Some(mut m) = self.matches.get(&id) else {
            return PromiseOrValue::Value(amount);
        };
        let Some(i) = m.players.iter().position(|p| p.account == sender_id) else {
            return PromiseOrValue::Value(amount);
        };
        if m.phase != Phase::Funding
            || env::block_timestamp() >= m.deadline.0
            || amount != m.stake
            || m.players[i].funded
        {
            return PromiseOrValue::Value(amount);
        }
        m.players[i].funded = true;
        if m.players.iter().all(|p| p.funded) {
            m.phase = Phase::Committing;
            m.deadline = deadline();
        }
        self.matches.insert(&id, &m);
        emit("stake_funded", &m);
        PromiseOrValue::Value(U128(0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::{
        test_utils::{VMContextBuilder, accounts, get_logs},
        testing_env,
    };

    fn ctx(caller: AccountId, timestamp: u64, deposit: NearToken) {
        testing_env!(
            VMContextBuilder::new()
                .current_account_id(accounts(5))
                .predecessor_account_id(caller)
                .block_timestamp(timestamp)
                .attached_deposit(deposit)
                .build()
        );
    }
    fn setup() -> Contract {
        ctx(accounts(0), 1, STORAGE_DEPOSIT);
        let mut c = Contract::new(accounts(4));
        c.create_match(accounts(1), U128(10));
        c
    }
    #[test]
    fn emits_structured_nep297_match_events() {
        let mut contract = setup();
        let log = get_logs().last().unwrap().clone();
        let event: near_sdk::serde_json::Value =
            near_sdk::serde_json::from_str(log.strip_prefix("EVENT_JSON:").unwrap()).unwrap();
        assert_eq!(event["standard"], "promptplay_rps");
        assert_eq!(event["version"], "1.0.0");
        assert_eq!(event["event"], "match_created");
        assert_eq!(event["data"][0]["match"]["id"], "0");
        assert_eq!(event["data"][0]["sequence"], "1");
        deposit(&mut contract, accounts(4), accounts(0), 10);
        let log = get_logs().last().unwrap().clone();
        let event: near_sdk::serde_json::Value =
            near_sdk::serde_json::from_str(log.strip_prefix("EVENT_JSON:").unwrap()).unwrap();
        assert_eq!(event["event"], "stake_funded");
        assert_eq!(event["data"][0]["match"]["players"][0]["funded"], true);
        assert_eq!(event["data"][0]["sequence"], "2");
    }
    fn deposit(c: &mut Contract, token: AccountId, sender: AccountId, amount: u128) -> u128 {
        ctx(token, 2, NearToken::from_yoctonear(0));
        match c.ft_on_transfer(sender, U128(amount), "0".into()) {
            PromiseOrValue::Value(v) => v.0,
            _ => unreachable!(),
        }
    }
    fn hash(id: u64, account: &AccountId, choice: u8, secret: &[u8; 32]) -> Base64VecU8 {
        hash_round(id, account, 1, choice, secret)
    }
    fn hash_round(
        id: u64,
        account: &AccountId,
        round: u32,
        choice: u8,
        secret: &[u8; 32],
    ) -> Base64VecU8 {
        let mut bytes = b"PromptPlay:RPS:v1".to_vec();
        for part in [accounts(5).as_bytes(), account.as_bytes()] {
            bytes.extend_from_slice(&(part.len() as u32).to_le_bytes());
            bytes.extend_from_slice(part);
        }
        bytes.extend_from_slice(&id.to_le_bytes());
        bytes.extend_from_slice(&round.to_le_bytes());
        bytes.push(choice);
        bytes.extend_from_slice(secret);
        Base64VecU8(env::sha256(&bytes))
    }
    fn fund(c: &mut Contract) {
        assert_eq!(deposit(c, accounts(4), accounts(0), 10), 0);
        assert_eq!(deposit(c, accounts(4), accounts(1), 10), 0);
    }
    #[test]
    fn deposit_validation_and_refund() {
        let mut c = setup();
        assert_eq!(deposit(&mut c, accounts(3), accounts(0), 10), 10);
        assert_eq!(deposit(&mut c, accounts(4), accounts(2), 10), 10);
        assert_eq!(deposit(&mut c, accounts(4), accounts(0), 11), 11);
        assert_eq!(deposit(&mut c, accounts(4), accounts(0), 10), 0);
        assert_eq!(deposit(&mut c, accounts(4), accounts(0), 10), 10);
        ctx(accounts(2), PHASE_NS + 1, NearToken::from_yoctonear(0));
        c.resolve_timeout(U64(0));
        let m = c.get_match(U64(0)).unwrap();
        assert!(m.phase == Phase::Cancelled);
        assert_eq!(m.players[0].claim.0, 10);
        assert_eq!(m.players[1].claim.0, 0);
    }
    #[test]
    fn all_outcomes_and_ties() {
        for a in 0..3 {
            for b in 0..3 {
                let mut c = setup();
                fund(&mut c);
                for (who, choice) in [(accounts(0), a), (accounts(1), b)] {
                    ctx(who.clone(), 3, NearToken::from_yoctonear(0));
                    c.commit_move(U64(0), hash_round(0, &who, 1, choice, &[choice; 32]));
                }
                for (who, choice) in [(accounts(0), a), (accounts(1), b)] {
                    ctx(who, 4, NearToken::from_yoctonear(0));
                    c.reveal_move(U64(0), choice, Base64VecU8(vec![choice; 32]));
                }
                let m = c.get_match(U64(0)).unwrap();
                assert!(m.phase == Phase::Committing);
                assert_eq!(m.round, 2);
                assert_eq!(m.players[0].claim.0, 0);
                assert_eq!(m.players[1].claim.0, 0);
                assert_eq!(
                    m.wins,
                    if a == b {
                        [0, 0]
                    } else if (a + 3 - b) % 3 == 1 {
                        [1, 0]
                    } else {
                        [0, 1]
                    }
                );
                assert!(
                    m.players
                        .iter()
                        .all(|p| p.commitment.is_none() && p.revealed.is_none())
                );
            }
        }
    }
    #[test]
    fn first_to_two_wins_settles_once_after_tied_round() {
        let mut c = setup();
        fund(&mut c);
        for (round, a, b) in [(1, 0, 0), (2, 0, 2), (3, 1, 0)] {
            for (who, choice) in [(accounts(0), a), (accounts(1), b)] {
                ctx(
                    who.clone(),
                    3 + u64::from(round) * 2,
                    NearToken::from_yoctonear(0),
                );
                c.commit_move(U64(0), hash_round(0, &who, round, choice, &[choice; 32]));
            }
            for (who, choice) in [(accounts(0), a), (accounts(1), b)] {
                ctx(who, 4 + u64::from(round) * 2, NearToken::from_yoctonear(0));
                c.reveal_move(U64(0), choice, Base64VecU8(vec![choice; 32]));
            }
        }
        let m = c.get_match(U64(0)).unwrap();
        assert!(m.phase == Phase::Completed);
        assert_eq!(m.wins, [2, 0]);
        assert_eq!(m.players[0].claim.0, 20);
        assert_eq!(m.players[1].claim.0, 0);
    }
    #[test]
    fn one_reveal_wins_on_timeout() {
        let mut c = setup();
        fund(&mut c);
        for who in [accounts(0), accounts(1)] {
            ctx(who.clone(), 3, NearToken::from_yoctonear(0));
            c.commit_move(U64(0), hash(0, &who, 0, &[5; 32]));
        }
        ctx(accounts(0), 4, NearToken::from_yoctonear(0));
        c.reveal_move(U64(0), 0, Base64VecU8(vec![5; 32]));
        ctx(accounts(2), PHASE_NS + 3, NearToken::from_yoctonear(0));
        c.resolve_timeout(U64(0));
        assert_eq!(c.get_match(U64(0)).unwrap().players[0].claim.0, 20);
    }
    #[test]
    fn failed_payout_restores_claim_for_retry() {
        let mut c = setup();
        deposit(&mut c, accounts(4), accounts(0), 10);
        ctx(accounts(2), PHASE_NS + 1, NearToken::from_yoctonear(0));
        c.resolve_timeout(U64(0));
        ctx(accounts(0), PHASE_NS + 2, NearToken::from_yoctonear(1));
        let _ = c.claim_payout(U64(0));
        let m = c.get_match(U64(0)).unwrap();
        assert!(m.players[0].pending);
        assert_eq!(m.players[0].claim.0, 0);
        let mut cb = VMContextBuilder::new();
        cb.current_account_id(accounts(5))
            .predecessor_account_id(accounts(5));
        testing_env!(
            cb.build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            Default::default(),
            vec![near_sdk::PromiseResult::Failed]
        );
        assert!(!c.on_payout(U64(0), 0, U128(10)));
        let m = c.get_match(U64(0)).unwrap();
        assert!(!m.players[0].pending);
        assert_eq!(m.players[0].claim.0, 10);
    }
    #[test]
    fn missing_commit_or_reveals_refund_both() {
        let mut c = setup();
        fund(&mut c);
        ctx(accounts(0), 3, NearToken::from_yoctonear(0));
        c.commit_move(U64(0), hash(0, &accounts(0), 0, &[5; 32]));
        ctx(accounts(2), PHASE_NS + 2, NearToken::from_yoctonear(0));
        c.resolve_timeout(U64(0));
        let m = c.get_match(U64(0)).unwrap();
        assert_eq!((m.players[0].claim.0, m.players[1].claim.0), (10, 10));

        let mut c = setup();
        fund(&mut c);
        for who in [accounts(0), accounts(1)] {
            ctx(who.clone(), 3, NearToken::from_yoctonear(0));
            c.commit_move(U64(0), hash(0, &who, 0, &[5; 32]));
        }
        ctx(accounts(2), PHASE_NS + 3, NearToken::from_yoctonear(0));
        c.resolve_timeout(U64(0));
        let m = c.get_match(U64(0)).unwrap();
        assert_eq!((m.players[0].claim.0, m.players[1].claim.0), (10, 10));
    }
    #[test]
    #[should_panic(expected = "Commitment mismatch")]
    fn wrong_secret_rejected() {
        let mut c = setup();
        fund(&mut c);
        for who in [accounts(0), accounts(1)] {
            ctx(who.clone(), 3, NearToken::from_yoctonear(0));
            c.commit_move(U64(0), hash(0, &who, 0, &[5; 32]));
        }
        ctx(accounts(0), 4, NearToken::from_yoctonear(0));
        c.reveal_move(U64(0), 0, Base64VecU8(vec![6; 32]));
    }
    #[test]
    #[should_panic(expected = "Nothing claimable")]
    fn duplicate_pending_claim_rejected() {
        let mut c = setup();
        deposit(&mut c, accounts(4), accounts(0), 10);
        ctx(accounts(2), PHASE_NS + 1, NearToken::from_yoctonear(0));
        c.resolve_timeout(U64(0));
        ctx(accounts(0), PHASE_NS + 2, NearToken::from_yoctonear(1));
        let _ = c.claim_payout(U64(0));
        let _ = c.claim_payout(U64(0));
    }
    #[test]
    fn creation_deposit_covers_completed_match_storage() {
        let alice: AccountId = format!("{}.testnet", "a".repeat(56)).parse().unwrap();
        let bob: AccountId = format!("{}.testnet", "b".repeat(56)).parse().unwrap();
        ctx(alice.clone(), 1, STORAGE_DEPOSIT);
        let mut c = Contract::new(accounts(4));
        let before = env::storage_usage();
        c.create_match(bob.clone(), U128(u128::MAX / 2));
        for who in [alice.clone(), bob.clone()] {
            ctx(accounts(4), 2, NearToken::from_yoctonear(0));
            let _ = c.ft_on_transfer(who, U128(u128::MAX / 2), "0".into());
        }
        for (who, choice) in [(alice.clone(), 0), (bob.clone(), 2)] {
            ctx(who.clone(), 3, NearToken::from_yoctonear(0));
            c.commit_move(U64(0), hash(0, &who, choice, &[4; 32]));
        }
        for (who, choice) in [(alice.clone(), 0), (bob.clone(), 2)] {
            ctx(who, 4, NearToken::from_yoctonear(0));
            c.reveal_move(U64(0), choice, Base64VecU8(vec![4; 32]));
        }
        for (who, choice) in [(alice.clone(), 0), (bob.clone(), 2)] {
            ctx(who.clone(), 5, NearToken::from_yoctonear(0));
            c.commit_move(U64(0), hash_round(0, &who, 2, choice, &[4; 32]));
        }
        for (who, choice) in [(alice, 0), (bob, 2)] {
            ctx(who, 6, NearToken::from_yoctonear(0));
            c.reveal_move(U64(0), choice, Base64VecU8(vec![4; 32]));
        }
        let bytes = env::storage_usage() - before;
        assert!(
            u128::from(bytes) * env::storage_byte_cost().as_yoctonear()
                <= STORAGE_DEPOSIT.as_yoctonear()
        );
    }
    #[test]
    #[should_panic(expected = "Players must differ")]
    fn rejects_self_match() {
        ctx(accounts(0), 1, STORAGE_DEPOSIT);
        let mut c = Contract::new(accounts(4));
        c.create_match(accounts(0), U128(10));
    }
    #[test]
    #[should_panic(expected = "Commit phase closed")]
    fn rejects_commit_at_deadline() {
        let mut c = setup();
        fund(&mut c);
        ctx(accounts(0), PHASE_NS + 2, NearToken::from_yoctonear(0));
        c.commit_move(U64(0), hash(0, &accounts(0), 0, &[4; 32]));
    }
    #[test]
    #[should_panic(expected = "Already committed")]
    fn rejects_duplicate_commitment() {
        let mut c = setup();
        fund(&mut c);
        ctx(accounts(0), 3, NearToken::from_yoctonear(0));
        c.commit_move(U64(0), hash(0, &accounts(0), 0, &[4; 32]));
        c.commit_move(U64(0), hash(0, &accounts(0), 0, &[4; 32]));
    }
    #[test]
    #[should_panic(expected = "Commitment mismatch")]
    fn commitment_cannot_be_replayed_for_another_match() {
        let mut c = setup();
        ctx(accounts(0), 1, STORAGE_DEPOSIT);
        c.create_match(accounts(1), U128(10));
        for who in [accounts(0), accounts(1)] {
            ctx(accounts(4), 2, NearToken::from_yoctonear(0));
            let _ = c.ft_on_transfer(who, U128(10), "1".into());
        }
        for who in [accounts(0), accounts(1)] {
            ctx(who.clone(), 3, NearToken::from_yoctonear(0));
            c.commit_move(U64(1), hash(0, &who, 0, &[4; 32]));
        }
        ctx(accounts(0), 4, NearToken::from_yoctonear(0));
        c.reveal_move(U64(1), 0, Base64VecU8(vec![4; 32]));
    }
    #[test]
    #[should_panic(expected = "Reveal phase closed")]
    fn early_reveal_rejected() {
        let mut c = setup();
        fund(&mut c);
        ctx(accounts(0), 3, NearToken::from_yoctonear(0));
        c.commit_move(U64(0), hash(0, &accounts(0), 0, &[5; 32]));
        c.reveal_move(U64(0), 0, Base64VecU8(vec![5; 32]));
    }
}
