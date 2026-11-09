use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_sdk::{
    AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue,
    collections::LookupMap,
    env, ext_contract,
    json_types::{U64, U128},
    near, require,
};
const PCC_PER_UNIT: u128 = 5_000_000;
const EXPIRY_NS: u64 = 900_000_000_000;
#[near(serializers=[json,borsh])]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Status {
    Pending,
    Consumed,
    Refunding,
}
#[near(serializers=[json,borsh])]
#[derive(Clone)]
pub struct Deposit {
    pub account: AccountId,
    pub amount: U128,
    pub units: U64,
    pub expires: U64,
    pub approved: bool,
    pub status: Status,
}
#[near(serializers=[json])]
pub struct Settings {
    pub token: AccountId,
    pub owner: AccountId,
    pub treasury: AccountId,
    pub cap: U64,
    pub allocated: U64,
}
#[ext_contract(ext_ft)]
#[allow(dead_code)]
trait Token {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}
#[ext_contract(ext_self)]
#[allow(dead_code)]
trait Callbacks {
    fn on_refund(&mut self, account: AccountId, id: String) -> bool;
    fn on_withdraw(&mut self, amount: U128) -> bool;
}
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    token: AccountId,
    owner: AccountId,
    treasury: AccountId,
    cap: u64,
    allocated: u64,
    withdrawable: u128,
    withdrawal_pending: bool,
    deposits: LookupMap<(AccountId, String), Deposit>,
    pending_by_account: LookupMap<AccountId, u64>,
}
#[near]
impl Contract {
    #[init]
    pub fn new(token: AccountId, owner: AccountId, treasury: AccountId, cap: U64) -> Self {
        require!(cap.0 > 0, "Invalid cap");
        Self {
            token,
            owner,
            treasury,
            cap: cap.0,
            allocated: 0,
            withdrawable: 0,
            withdrawal_pending: false,
            deposits: LookupMap::new(b"d"),
            pending_by_account: LookupMap::new(b"p"),
        }
    }
    pub fn get_deposit(&self, account: AccountId, id: String) -> Option<Deposit> {
        self.deposits.get(&(account, id))
    }
    pub fn capacity(&self) -> U64 {
        U64(self.cap - self.allocated)
    }
    pub fn settings(&self) -> Settings {
        Settings {
            token: self.token.clone(),
            owner: self.owner.clone(),
            treasury: self.treasury.clone(),
            cap: U64(self.cap),
            allocated: U64(self.allocated),
        }
    }
    pub fn approve(&mut self, account: AccountId, id: String, amount: U128, expires: U64) {
        require!(env::predecessor_account_id() == self.owner, "Only owner");
        let key = (account, id);
        let mut d = self.deposits.get(&key).expect("Unknown deposit");
        require!(
            d.amount == amount && d.expires == expires,
            "Deposit changed"
        );
        require!(
            d.status == Status::Pending && env::block_timestamp() < d.expires.0,
            "Deposit unavailable"
        );
        d.approved = true;
        self.deposits.insert(&key, &d);
    }
    pub fn consume(&mut self, id: String) {
        let key = (env::predecessor_account_id(), id);
        let mut d = self.deposits.get(&key).expect("Unknown deposit");
        require!(d.account == env::predecessor_account_id(), "Not depositor");
        require!(
            d.status == Status::Pending && d.approved && env::block_timestamp() < d.expires.0,
            "Deposit unavailable"
        );
        self.withdrawable = self
            .withdrawable
            .checked_add(d.amount.0)
            .expect("Amount overflow");
        d.status = Status::Consumed;
        self.release_pending(&d.account, d.units.0);
        self.deposits.insert(&key, &d);
    }
    #[payable]
    pub fn refund(&mut self, id: String) -> Promise {
        near_sdk::assert_one_yocto();
        let account = env::predecessor_account_id();
        let key = (account.clone(), id.clone());
        let mut d = self.deposits.get(&key).expect("Unknown deposit");
        require!(d.account == env::predecessor_account_id(), "Not depositor");
        require!(
            d.status == Status::Pending && env::block_timestamp() >= d.expires.0,
            "Refund unavailable"
        );
        d.status = Status::Refunding;
        self.deposits.insert(&key, &d);
        ext_ft::ext(self.token.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(Gas::from_tgas(15))
            .ft_transfer(d.account, d.amount, Some("PromptPlay refund".into()))
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(10))
                    .on_refund(account, id),
            )
    }
    #[private]
    pub fn on_refund(&mut self, account: AccountId, id: String) -> bool {
        let key = (account, id);
        let mut d = self.deposits.get(&key).expect("Unknown deposit");
        require!(d.status == Status::Refunding, "No refund pending");
        let success = env::promise_result_checked(0, 0).is_ok();
        if success {
            self.allocated = self
                .allocated
                .checked_sub(d.units.0)
                .expect("Invalid allocation");
            self.release_pending(&d.account, d.units.0);
            self.deposits.remove(&key);
            env::log_str(&format!(
                "EVENT_JSON:{}",
                near_sdk::serde_json::json!({
                    "standard":"promptplay", "version":"1.0.0", "event":"redemption_refunded",
                    "data":[{"account":key.0,"id":key.1,"amount":d.amount,"units":d.units}]
                })
            ));
        } else {
            d.status = Status::Pending;
            self.deposits.insert(&key, &d);
        }
        success
    }
    #[payable]
    pub fn withdraw(&mut self, amount: U128) -> Promise {
        near_sdk::assert_one_yocto();
        require!(env::predecessor_account_id() == self.owner, "Only owner");
        require!(
            !self.withdrawal_pending && amount.0 > 0 && amount.0 <= self.withdrawable,
            "Withdrawal unavailable"
        );
        self.withdrawable -= amount.0;
        self.withdrawal_pending = true;
        ext_ft::ext(self.token.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(Gas::from_tgas(15))
            .ft_transfer(
                self.treasury.clone(),
                amount,
                Some("PromptPlay redemption".into()),
            )
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(10))
                    .on_withdraw(amount),
            )
    }
    #[private]
    pub fn on_withdraw(&mut self, amount: U128) -> bool {
        require!(self.withdrawal_pending, "No withdrawal pending");
        let success = env::promise_result_checked(0, 0).is_ok();
        self.withdrawal_pending = false;
        if !success {
            self.withdrawable = self
                .withdrawable
                .checked_add(amount.0)
                .expect("Amount overflow");
        }
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
        if env::predecessor_account_id() != self.token
            || msg.len() < 32
            || msg.len() > 64
            || !msg
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
            || self
                .deposits
                .get(&(sender_id.clone(), msg.clone()))
                .is_some()
            || amount.0 == 0
            || !amount.0.is_multiple_of(PCC_PER_UNIT)
        {
            return PromiseOrValue::Value(amount);
        }
        let Ok(units) = u64::try_from(amount.0 / PCC_PER_UNIT) else {
            return PromiseOrValue::Value(amount);
        };
        let old_pending = self.pending_by_account.get(&sender_id).unwrap_or(0);
        let Some(new_pending) = old_pending.checked_add(units) else {
            return PromiseOrValue::Value(amount);
        };
        if new_pending > 2 {
            return PromiseOrValue::Value(amount);
        }
        let Some(total) = self.allocated.checked_add(units) else {
            return PromiseOrValue::Value(amount);
        };
        if total > self.cap {
            return PromiseOrValue::Value(amount);
        }
        let Some(expires) = env::block_timestamp().checked_add(EXPIRY_NS) else {
            return PromiseOrValue::Value(amount);
        };
        let key = (sender_id.clone(), msg);
        self.deposits.insert(
            &key,
            &Deposit {
                account: sender_id,
                amount,
                units: U64(units),
                expires: U64(expires),
                approved: false,
                status: Status::Pending,
            },
        );
        self.pending_by_account.insert(&key.0, &new_pending);
        let cost = u128::from(env::storage_usage()) * env::storage_byte_cost().as_yoctonear();
        if env::account_balance().as_yoctonear() < cost {
            self.deposits.remove(&key);
            if old_pending == 0 {
                self.pending_by_account.remove(&key.0);
            } else {
                self.pending_by_account.insert(&key.0, &old_pending);
            }
            return PromiseOrValue::Value(amount);
        }
        self.allocated = total;
        PromiseOrValue::Value(U128(0))
    }
}

impl Contract {
    fn release_pending(&mut self, account: &AccountId, units: u64) {
        let remaining = self
            .pending_by_account
            .get(account)
            .expect("Missing pending allocation")
            .checked_sub(units)
            .expect("Invalid pending allocation");
        if remaining == 0 {
            self.pending_by_account.remove(account);
        } else {
            self.pending_by_account.insert(account, &remaining);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::{
        test_utils::{VMContextBuilder, accounts, get_logs},
        testing_env,
    };
    fn ctx(who: AccountId, time: u64, deposit: u128) {
        testing_env!(
            VMContextBuilder::new()
                .current_account_id(accounts(5))
                .predecessor_account_id(who)
                .block_timestamp(time)
                .attached_deposit(NearToken::from_yoctonear(deposit))
                .build()
        );
    }
    fn setup() -> Contract {
        ctx(accounts(0), 1, 0);
        Contract::new(accounts(4), accounts(0), accounts(3), U64(2))
    }
    fn send(c: &mut Contract, who: AccountId, amount: u128, id: &str) -> u128 {
        ctx(accounts(4), 1, 0);
        match c.ft_on_transfer(who, U128(amount), id.into()) {
            PromiseOrValue::Value(v) => v.0,
            _ => unreachable!(),
        }
    }
    #[test]
    fn accepts_valid_deposits_and_refunds_over_capacity_or_duplicates() {
        let mut c = setup();
        let a = "a".repeat(32);
        let b = "b".repeat(32);
        assert_eq!(send(&mut c, accounts(1), PCC_PER_UNIT, &a), 0);
        assert_eq!(c.capacity().0, 1);
        assert_eq!(send(&mut c, accounts(1), PCC_PER_UNIT, &a), PCC_PER_UNIT);
        assert_eq!(
            send(&mut c, accounts(2), 2 * PCC_PER_UNIT, &b),
            2 * PCC_PER_UNIT
        );
        assert_eq!(send(&mut c, accounts(2), PCC_PER_UNIT, &b), 0);
        assert_eq!(c.capacity().0, 0);
    }
    #[test]
    fn consumed_deposit_cannot_be_refunded() {
        let mut c = setup();
        let a = "a".repeat(32);
        send(&mut c, accounts(1), PCC_PER_UNIT, &a);
        ctx(accounts(0), 2, 0);
        c.approve(
            accounts(1),
            a.clone(),
            U128(PCC_PER_UNIT),
            U64(EXPIRY_NS + 1),
        );
        ctx(accounts(1), 2, 0);
        c.consume(a.clone());
        assert_eq!(
            c.get_deposit(accounts(1), a.clone()).unwrap().status,
            Status::Consumed
        );
        assert_eq!(c.withdrawable, PCC_PER_UNIT);
        ctx(accounts(1), EXPIRY_NS + 1, 1);
        let error = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.refund(a)));
        assert!(error.is_err());
    }
    #[test]
    fn refund_failure_restores_claim_and_success_releases_capacity() {
        let mut c = setup();
        let a = "a".repeat(32);
        send(&mut c, accounts(1), PCC_PER_UNIT, &a);
        ctx(accounts(0), 2, 0);
        c.approve(
            accounts(1),
            a.clone(),
            U128(PCC_PER_UNIT),
            U64(EXPIRY_NS + 1),
        );
        ctx(accounts(1), EXPIRY_NS + 1, 1);
        let _ = c.refund(a.clone());
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
        assert!(!c.on_refund(accounts(1), a.clone()));
        assert_eq!(c.capacity().0, 1);
        ctx(accounts(1), EXPIRY_NS + 2, 1);
        let _ = c.refund(a.clone());
        testing_env!(
            cb.build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            Default::default(),
            vec![near_sdk::PromiseResult::Successful(vec![])]
        );
        assert!(c.on_refund(accounts(1), a.clone()));
        assert_eq!(c.capacity().0, 2);
        assert!(
            get_logs()
                .iter()
                .any(|entry| entry.contains("redemption_refunded"))
        );
        assert!(c.get_deposit(accounts(1), a.clone()).is_none());
        assert_eq!(send(&mut c, accounts(1), PCC_PER_UNIT, &a), 0);
    }
    #[test]
    #[should_panic(expected = "Unknown deposit")]
    fn outsider_cannot_consume() {
        let mut c = setup();
        let a = "a".repeat(32);
        send(&mut c, accounts(1), PCC_PER_UNIT, &a);
        ctx(accounts(2), 2, 0);
        c.consume(a);
    }
    #[test]
    fn identifiers_are_scoped_to_depositor() {
        let mut c = setup();
        let id = "c".repeat(32);
        assert_eq!(send(&mut c, accounts(1), PCC_PER_UNIT, &id), 0);
        assert_eq!(send(&mut c, accounts(2), PCC_PER_UNIT, &id), 0);
        assert_eq!(
            c.get_deposit(accounts(1), id.clone()).unwrap().account,
            accounts(1)
        );
        assert_eq!(c.get_deposit(accounts(2), id).unwrap().account, accounts(2));
    }
    #[test]
    fn account_pending_cap_is_released_after_consumption() {
        let mut c = setup();
        c.cap = 4;
        let a = "a".repeat(32);
        let b = "b".repeat(32);
        let third = "c".repeat(32);
        assert_eq!(send(&mut c, accounts(1), PCC_PER_UNIT, &a), 0);
        assert_eq!(send(&mut c, accounts(1), PCC_PER_UNIT, &b), 0);
        assert_eq!(
            send(&mut c, accounts(1), PCC_PER_UNIT, &third),
            PCC_PER_UNIT
        );
        ctx(accounts(0), 2, 0);
        c.approve(
            accounts(1),
            a.clone(),
            U128(PCC_PER_UNIT),
            U64(EXPIRY_NS + 1),
        );
        ctx(accounts(1), 2, 0);
        c.consume(a);
        assert_eq!(send(&mut c, accounts(1), PCC_PER_UNIT, &third), 0);
    }
    #[test]
    fn failed_treasury_withdrawal_can_be_retried() {
        let mut c = setup();
        let id = "w".repeat(32);
        send(&mut c, accounts(1), PCC_PER_UNIT, &id);
        ctx(accounts(0), 2, 0);
        c.approve(
            accounts(1),
            id.clone(),
            U128(PCC_PER_UNIT),
            U64(EXPIRY_NS + 1),
        );
        ctx(accounts(1), 2, 0);
        c.consume(id);
        ctx(accounts(0), 3, 1);
        let _ = c.withdraw(U128(PCC_PER_UNIT));
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
        assert!(!c.on_withdraw(U128(PCC_PER_UNIT)));
        assert_eq!(c.withdrawable, PCC_PER_UNIT);
        assert!(!c.withdrawal_pending);
        ctx(accounts(0), 4, 1);
        let _ = c.withdraw(U128(PCC_PER_UNIT));
    }
    #[test]
    #[should_panic(expected = "Deposit unavailable")]
    fn deposit_cannot_be_consumed_without_operator_approval() {
        let mut c = setup();
        let id = "u".repeat(32);
        send(&mut c, accounts(1), PCC_PER_UNIT, &id);
        ctx(accounts(1), 2, 0);
        c.consume(id);
    }
    #[test]
    #[should_panic(expected = "Only owner")]
    fn outsider_cannot_approve() {
        let mut c = setup();
        let id = "u".repeat(32);
        send(&mut c, accounts(1), PCC_PER_UNIT, &id);
        ctx(accounts(2), 2, 0);
        c.approve(accounts(1), id, U128(PCC_PER_UNIT), U64(EXPIRY_NS + 1));
    }
    #[test]
    #[should_panic(expected = "Deposit changed")]
    fn approval_rejects_stale_deposit_expiry() {
        let mut c = setup();
        let id = "u".repeat(32);
        send(&mut c, accounts(1), PCC_PER_UNIT, &id);
        ctx(accounts(0), 2, 0);
        c.approve(accounts(1), id, U128(PCC_PER_UNIT), U64(EXPIRY_NS + 2));
    }
}
