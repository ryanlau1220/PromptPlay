// Standard token interface adapted from https://github.com/near-examples/FT (MIT OR Apache-2.0).
use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider,
};
use near_contract_standards::fungible_token::{
    FungibleToken, FungibleTokenCore, FungibleTokenResolver,
};
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::borsh::BorshSerialize;
use near_sdk::collections::LazyOption;
use near_sdk::json_types::U128;
use near_sdk::{
    AccountId, BorshStorageKey, NearToken, PanicOnDefault, PromiseOrValue, env, log, near, require,
};

#[derive(PanicOnDefault)]
#[near(contract_state)]
pub struct Contract {
    issuer: AccountId,
    token: FungibleToken,
    metadata: LazyOption<FungibleTokenMetadata>,
}

#[derive(BorshSerialize, BorshStorageKey)]
#[borsh(crate = "near_sdk::borsh")]
enum StorageKey {
    FungibleToken,
    Metadata,
}

#[near]
impl Contract {
    /// Initializes the token with zero supply and a designated issuer.
    #[init]
    pub fn new(issuer: AccountId) -> Self {
        let metadata = FungibleTokenMetadata {
            spec: "ft-1.0.0".into(),
            name: "PromptPlay Compute Credit".into(),
            symbol: "PCC".into(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: 6,
        };
        require!(!env::state_exists(), "Already initialized");
        metadata.assert_valid();
        Self {
            issuer,
            token: FungibleToken::new(StorageKey::FungibleToken),
            metadata: LazyOption::new(StorageKey::Metadata, Some(&metadata)),
        }
    }
    /// Mint demo credits to an already registered account.
    #[payable]
    pub fn mint(&mut self, account_id: AccountId, amount: U128) {
        near_sdk::assert_one_yocto();
        require!(env::predecessor_account_id() == self.issuer, "Only issuer");
        require!(amount.0 > 0, "Amount must be positive");
        self.token.internal_deposit(&account_id, amount.0);
        near_contract_standards::fungible_token::events::FtMint {
            owner_id: &account_id,
            amount,
            memo: Some("Testnet demo issuance"),
        }
        .emit();
    }
}

#[near]
impl FungibleTokenCore for Contract {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for Contract {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        let (used_amount, burned_amount) =
            self.token
                .internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        if burned_amount > 0 {
            log!("Account @{} burned {}", sender_id, burned_amount);
        }
        used_amount.into()
    }
}

#[near]
impl StorageManagement for Contract {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        #[allow(unused_variables)]
        if let Some((account_id, balance)) = self.token.internal_storage_unregister(force) {
            log!("Closed @{} with {}", account_id, balance);
            true
        } else {
            false
        }
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for Contract {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.metadata.get().unwrap()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::{
        test_utils::{VMContextBuilder, accounts},
        testing_env,
    };

    fn context(caller: AccountId, deposit: NearToken) {
        testing_env!(
            VMContextBuilder::new()
                .predecessor_account_id(caller)
                .attached_deposit(deposit)
                .build()
        );
    }

    #[test]
    fn issuer_mints_and_registered_users_transfer() {
        let issuer = accounts(0);
        let alice = accounts(1);
        let bob = accounts(2);
        context(issuer.clone(), NearToken::from_yoctonear(0));
        let mut contract = Contract::new(issuer.clone());
        let storage = contract.storage_balance_bounds().min;
        context(alice.clone(), storage);
        contract.storage_deposit(None, None);
        context(bob.clone(), storage);
        contract.storage_deposit(None, None);
        context(issuer, NearToken::from_yoctonear(1));
        contract.mint(alice.clone(), U128(100));
        context(alice.clone(), NearToken::from_yoctonear(1));
        contract.ft_transfer(bob.clone(), U128(40), None);
        assert_eq!(contract.ft_balance_of(alice).0, 60);
        assert_eq!(contract.ft_balance_of(bob).0, 40);
        assert_eq!(contract.ft_total_supply().0, 100);
        assert_eq!(contract.ft_metadata().symbol, "PCC");
    }

    #[test]
    #[should_panic(expected = "Only issuer")]
    fn unauthorized_mint_is_rejected() {
        context(accounts(0), NearToken::from_yoctonear(0));
        let mut contract = Contract::new(accounts(0));
        context(accounts(1), NearToken::from_yoctonear(1));
        contract.mint(accounts(1), U128(100));
    }
}
