use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_sdk::{
    AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue,
    collections::LookupMap,
    env, ext_contract,
    json_types::{U64, U128},
    near, require,
};
const PHASE_NS: u64 = 300_000_000_000;
const STORAGE_DEPOSIT: NearToken = NearToken::from_millinear(10);
#[near(serializers=[json,borsh])]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Phase {
    Funding,
    Agreement,
    Completed,
    Cancelled,
}
#[near(serializers=[json,borsh])]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Outcome {
    PlayerOne,
    PlayerTwo,
    Tie,
}
#[near(serializers=[json,borsh])]
#[derive(Clone)]
pub struct Player {
    account: AccountId,
    funded: bool,
    vote: Option<Outcome>,
    claim: U128,
    pending: bool,
}
#[near(serializers=[json,borsh])]
#[derive(Clone)]
pub struct Match {
    id: U64,
    game: String,
    stake: U128,
    players: [Player; 2],
    phase: Phase,
    deadline: U64,
    outcome: Option<Outcome>,
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
fn deadline() -> U64 {
    U64(env::block_timestamp()
        .checked_add(PHASE_NS)
        .expect("Timestamp overflow"))
}
fn player(account: AccountId) -> Player {
    Player {
        account,
        funded: false,
        vote: None,
        claim: U128(0),
        pending: false,
    }
}
fn index(m: &Match, caller: &AccountId) -> usize {
    m.players
        .iter()
        .position(|p| &p.account == caller)
        .unwrap_or_else(|| env::panic_str("Not a player"))
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
    #[payable]
    pub fn create_match(&mut self, game: String, opponent: AccountId, stake: U128) -> U64 {
        let caller = env::predecessor_account_id();
        require!(
            env::attached_deposit() >= STORAGE_DEPOSIT,
            "Insufficient storage deposit"
        );
        require!(caller != opponent, "Players must differ");
        require!(
            !game.is_empty()
                && game.len() <= 64
                && game
                    .bytes()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-'),
            "Invalid game ID"
        );
        require!(stake.0 > 0 && stake.0 <= u128::MAX / 2, "Invalid stake");
        let id = self.next_id;
        self.next_id = id.checked_add(1).expect("Match IDs exhausted");
        self.matches.insert(
            &id,
            &Match {
                id: U64(id),
                game,
                stake,
                players: [player(caller), player(opponent)],
                phase: Phase::Funding,
                deadline: deadline(),
                outcome: None,
            },
        );
        U64(id)
    }
    pub fn get_match(&self, match_id: U64) -> Option<Match> {
        self.matches.get(&match_id.0)
    }
    /// Both players must submit the same outcome; votes can be changed until agreement.
    pub fn agree_result(&mut self, match_id: U64, outcome: Outcome) {
        let mut m = self.matches.get(&match_id.0).expect("Unknown match");
        require!(
            m.phase == Phase::Agreement && env::block_timestamp() < m.deadline.0,
            "Agreement phase closed"
        );
        let i = index(&m, &env::predecessor_account_id());
        m.players[i].vote = Some(outcome.clone());
        if m.players[0].vote == m.players[1].vote {
            match outcome {
                Outcome::PlayerOne => m.players[0].claim = U128(m.stake.0 * 2),
                Outcome::PlayerTwo => m.players[1].claim = U128(m.stake.0 * 2),
                Outcome::Tie => {
                    m.players[0].claim = m.stake;
                    m.players[1].claim = m.stake;
                }
            }
            m.outcome = Some(outcome);
            m.phase = Phase::Completed;
        }
        self.matches.insert(&match_id.0, &m);
    }
    pub fn resolve_timeout(&mut self, match_id: U64) {
        let mut m = self.matches.get(&match_id.0).expect("Unknown match");
        require!(
            env::block_timestamp() >= m.deadline.0,
            "Deadline not reached"
        );
        require!(
            m.phase == Phase::Funding || m.phase == Phase::Agreement,
            "Match already resolved"
        );
        for p in &mut m.players {
            if p.funded {
                p.claim = m.stake;
            }
        }
        m.phase = Phase::Cancelled;
        self.matches.insert(&match_id.0, &m);
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
            m.phase = Phase::Agreement;
            m.deadline = deadline();
        }
        self.matches.insert(&id, &m);
        PromiseOrValue::Value(U128(0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::{
        test_utils::{VMContextBuilder, accounts},
        testing_env,
    };
    fn ctx(who: AccountId, t: u64, amount: NearToken) {
        testing_env!(
            VMContextBuilder::new()
                .current_account_id(accounts(5))
                .predecessor_account_id(who)
                .block_timestamp(t)
                .attached_deposit(amount)
                .build()
        );
    }
    fn setup() -> Contract {
        ctx(accounts(0), 1, STORAGE_DEPOSIT);
        let mut c = Contract::new(accounts(4));
        c.create_match("chess-v1".into(), accounts(1), U128(10));
        c
    }
    fn deposit(c: &mut Contract, token: AccountId, who: AccountId, amount: u128) -> u128 {
        ctx(token, 2, NearToken::from_yoctonear(0));
        match c.ft_on_transfer(who, U128(amount), "0".into()) {
            PromiseOrValue::Value(v) => v.0,
            _ => unreachable!(),
        }
    }
    fn fund(c: &mut Contract) {
        assert_eq!(deposit(c, accounts(4), accounts(0), 10), 0);
        assert_eq!(deposit(c, accounts(4), accounts(1), 10), 0);
    }
    #[test]
    fn funding_rejects_wrong_deposits_and_refunds() {
        let mut c = setup();
        assert_eq!(deposit(&mut c, accounts(3), accounts(0), 10), 10);
        assert_eq!(deposit(&mut c, accounts(4), accounts(2), 10), 10);
        assert_eq!(deposit(&mut c, accounts(4), accounts(0), 11), 11);
        assert_eq!(deposit(&mut c, accounts(4), accounts(0), 10), 0);
        assert_eq!(deposit(&mut c, accounts(4), accounts(0), 10), 10);
        ctx(accounts(2), PHASE_NS + 1, NearToken::from_yoctonear(0));
        c.resolve_timeout(U64(0));
        let m = c.get_match(U64(0)).unwrap();
        assert_eq!(m.phase, Phase::Cancelled);
        assert_eq!((m.players[0].claim.0, m.players[1].claim.0), (10, 0));
    }
    #[test]
    fn mutual_results_allocate_exact_escrow() {
        for (result, claims) in [
            (Outcome::PlayerOne, (20, 0)),
            (Outcome::PlayerTwo, (0, 20)),
            (Outcome::Tie, (10, 10)),
        ] {
            let mut c = setup();
            fund(&mut c);
            ctx(accounts(0), 3, NearToken::from_yoctonear(0));
            c.agree_result(U64(0), result.clone());
            assert_eq!(c.get_match(U64(0)).unwrap().phase, Phase::Agreement);
            ctx(accounts(1), 4, NearToken::from_yoctonear(0));
            c.agree_result(U64(0), result.clone());
            let m = c.get_match(U64(0)).unwrap();
            assert_eq!(m.phase, Phase::Completed);
            assert_eq!(m.outcome, Some(result));
            assert_eq!((m.players[0].claim.0, m.players[1].claim.0), claims);
        }
    }
    #[test]
    fn disagreement_times_out_to_refunds() {
        let mut c = setup();
        fund(&mut c);
        ctx(accounts(0), 3, NearToken::from_yoctonear(0));
        c.agree_result(U64(0), Outcome::PlayerOne);
        ctx(accounts(1), 4, NearToken::from_yoctonear(0));
        c.agree_result(U64(0), Outcome::PlayerTwo);
        ctx(accounts(2), PHASE_NS + 2, NearToken::from_yoctonear(0));
        c.resolve_timeout(U64(0));
        let m = c.get_match(U64(0)).unwrap();
        assert_eq!(m.phase, Phase::Cancelled);
        assert_eq!((m.players[0].claim.0, m.players[1].claim.0), (10, 10));
    }
    #[test]
    fn changing_a_vote_can_resolve_a_disagreement() {
        let mut c = setup();
        fund(&mut c);
        ctx(accounts(0), 3, NearToken::from_yoctonear(0));
        c.agree_result(U64(0), Outcome::PlayerOne);
        ctx(accounts(1), 4, NearToken::from_yoctonear(0));
        c.agree_result(U64(0), Outcome::PlayerTwo);
        ctx(accounts(0), 5, NearToken::from_yoctonear(0));
        c.agree_result(U64(0), Outcome::PlayerTwo);
        let m = c.get_match(U64(0)).unwrap();
        assert_eq!(m.phase, Phase::Completed);
        assert_eq!((m.players[0].claim.0, m.players[1].claim.0), (0, 20));
    }
    #[test]
    fn creation_deposit_covers_maximum_match_storage() {
        let alice: AccountId = format!("{}.testnet", "a".repeat(56)).parse().unwrap();
        let bob: AccountId = format!("{}.testnet", "b".repeat(56)).parse().unwrap();
        ctx(alice.clone(), 1, STORAGE_DEPOSIT);
        let mut c = Contract::new(accounts(4));
        let before = env::storage_usage();
        c.create_match("g".repeat(64), bob.clone(), U128(u128::MAX / 2));
        for who in [alice.clone(), bob.clone()] {
            ctx(accounts(4), 2, NearToken::from_yoctonear(0));
            let _ = c.ft_on_transfer(who, U128(u128::MAX / 2), "0".into());
        }
        for who in [alice, bob] {
            ctx(who, 3, NearToken::from_yoctonear(0));
            c.agree_result(U64(0), Outcome::PlayerOne);
        }
        assert!(
            u128::from(env::storage_usage() - before) * env::storage_byte_cost().as_yoctonear()
                <= STORAGE_DEPOSIT.as_yoctonear()
        );
    }
    #[test]
    #[should_panic(expected = "Agreement phase closed")]
    fn votes_at_deadline_are_rejected() {
        let mut c = setup();
        fund(&mut c);
        ctx(accounts(0), PHASE_NS + 2, NearToken::from_yoctonear(0));
        c.agree_result(U64(0), Outcome::Tie);
    }
    #[test]
    #[should_panic(expected = "Match already resolved")]
    fn settlement_cannot_be_replayed() {
        let mut c = setup();
        fund(&mut c);
        for who in [accounts(0), accounts(1)] {
            ctx(who, 3, NearToken::from_yoctonear(0));
            c.agree_result(U64(0), Outcome::Tie);
        }
        ctx(accounts(2), PHASE_NS + 2, NearToken::from_yoctonear(0));
        c.resolve_timeout(U64(0));
    }
    #[test]
    #[should_panic(expected = "Not a player")]
    fn outsider_cannot_vote() {
        let mut c = setup();
        fund(&mut c);
        ctx(accounts(2), 3, NearToken::from_yoctonear(0));
        c.agree_result(U64(0), Outcome::Tie);
    }
    #[test]
    #[should_panic(expected = "Nothing claimable")]
    fn pending_claim_cannot_be_duplicated() {
        let mut c = setup();
        deposit(&mut c, accounts(4), accounts(0), 10);
        ctx(accounts(2), PHASE_NS + 1, NearToken::from_yoctonear(0));
        c.resolve_timeout(U64(0));
        ctx(accounts(0), PHASE_NS + 2, NearToken::from_yoctonear(1));
        let _ = c.claim_payout(U64(0));
        let _ = c.claim_payout(U64(0));
    }
    #[test]
    fn failed_payout_can_be_retried() {
        let mut c = setup();
        deposit(&mut c, accounts(4), accounts(0), 10);
        ctx(accounts(2), PHASE_NS + 1, NearToken::from_yoctonear(0));
        c.resolve_timeout(U64(0));
        ctx(accounts(0), PHASE_NS + 2, NearToken::from_yoctonear(1));
        let _ = c.claim_payout(U64(0));
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
}
