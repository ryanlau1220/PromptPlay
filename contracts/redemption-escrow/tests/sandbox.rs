use near_api::types::{AccessKeyPermission, transaction::actions::FunctionCallPermission};
use near_api::{AccountId, NearGas, NearToken};
use near_sdk::serde_json::{Value, json};
#[tokio::test]
async fn capacity_rejection_refunds_and_consumed_pcc_reaches_treasury() -> testresult::TestResult<()>
{
    let sandbox = near_sandbox::Sandbox::start_sandbox().await?;
    let network = near_api::NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let signer = near_api::Signer::from_secret_key(
        near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?,
    )?;
    for name in [
        "token.sandbox",
        "escrow.sandbox",
        "alice.sandbox",
        "treasury.sandbox",
    ] {
        sandbox
            .create_account(name.parse()?)
            .initial_balance(NearToken::from_near(10))
            .send()
            .await?;
    }
    let token_id: AccountId = "token.sandbox".parse()?;
    let escrow_id: AccountId = "escrow.sandbox".parse()?;
    let alice: AccountId = "alice.sandbox".parse()?;
    let restricted_key = near_api::signer::generate_secret_key()?;
    let restricted_signer = near_api::Signer::from_secret_key(restricted_key)?;
    let restricted_public_key = restricted_signer.get_public_key().await?;
    near_api::Account(alice.clone())
        .add_key(
            AccessKeyPermission::FunctionCall(FunctionCallPermission {
                allowance: Some(NearToken::from_near(1)),
                receiver_id: "escrow.sandbox".to_string(),
                method_names: vec!["approve".to_string()],
            }),
            restricted_public_key,
        )
        .with_signer(signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    let token = near_api::Account(token_id.clone()).as_contract();
    let escrow = near_api::Account(escrow_id.clone()).as_contract();
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    for (id, path, args) in [
        (
            token_id.clone(),
            root.join("../compute-credit/target/near/compute_credit.wasm"),
            json!({"issuer":"alice.sandbox"}),
        ),
        (
            escrow_id.clone(),
            root.join("target/near/redemption_escrow.wasm"),
            json!({"token":"token.sandbox","owner":"alice.sandbox","treasury":"treasury.sandbox","cap":"1"}),
        ),
    ] {
        near_api::Contract::deploy(id)
            .use_code(std::fs::read(path)?)
            .with_init_call("new", args)?
            .with_signer(signer.clone())
            .send_to(&network)
            .await?
            .assert_success();
    }
    for account in ["alice.sandbox", "escrow.sandbox", "treasury.sandbox"] {
        token
            .call_function(
                "storage_deposit",
                json!({"account_id":account,"registration_only":true}),
            )
            .transaction()
            .deposit(NearToken::from_millinear(2))
            .with_signer(alice.clone(), signer.clone())
            .send_to(&network)
            .await?
            .assert_success();
    }
    token
        .call_function(
            "mint",
            json!({"account_id":"alice.sandbox","amount":"10000000"}),
        )
        .transaction()
        .deposit(NearToken::from_yoctonear(1))
        .with_signer(alice.clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    let first = "a".repeat(32);
    let second = "b".repeat(32);
    for id in [&first, &second] {
        token
            .call_function(
                "ft_transfer_call",
                json!({"receiver_id":"escrow.sandbox","amount":"5000000","memo":null,"msg":id}),
            )
            .transaction()
            .gas(NearGas::from_tgas(100))
            .deposit(NearToken::from_yoctonear(1))
            .with_signer(alice.clone(), signer.clone())
            .send_to(&network)
            .await?
            .assert_success();
    }
    let balance: String = token
        .call_function("ft_balance_of", json!({"account_id":"alice.sandbox"}))
        .read_only()
        .fetch_from(&network)
        .await?
        .data;
    assert_eq!(balance, "5000000");
    let deposit: Value = escrow
        .call_function("get_deposit", json!({"account":"alice.sandbox","id":first}))
        .read_only()
        .fetch_from(&network)
        .await?
        .data;
    assert_eq!(deposit["status"], "Pending");
    escrow
        .call_function("on_refund", json!({"account":"alice.sandbox","id":first}))
        .transaction()
        .with_signer(alice.clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_failure();
    escrow
        .call_function("consume", json!({"id":first}))
        .transaction()
        .with_signer(alice.clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_failure();
    escrow
        .call_function("approve", json!({"account":"alice.sandbox","id":first,"amount":"5000000","expires":deposit["expires"]}))
        .transaction()
        .with_signer(alice.clone(), restricted_signer)
        .send_to(&network)
        .await?
        .assert_success();
    escrow
        .call_function("consume", json!({"id":first}))
        .transaction()
        .with_signer(alice.clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    escrow
        .call_function("on_withdraw", json!({"amount":"5000000"}))
        .transaction()
        .with_signer(alice.clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_failure();
    escrow
        .call_function("withdraw", json!({"amount":"5000000"}))
        .transaction()
        .gas(NearGas::from_tgas(70))
        .deposit(NearToken::from_yoctonear(1))
        .with_signer(alice.clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    let balance: String = token
        .call_function("ft_balance_of", json!({"account_id":"treasury.sandbox"}))
        .read_only()
        .fetch_from(&network)
        .await?
        .data;
    assert_eq!(balance, "5000000");
    Ok(())
}

#[tokio::test]
async fn gateway_redeems_against_real_sandbox_contracts() -> testresult::TestResult<()> {
    let sandbox = near_sandbox::Sandbox::start_sandbox().await?;
    let network = near_api::NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let genesis = near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY;
    let signer = near_api::Signer::from_secret_key(genesis.parse()?)?;
    for name in [
        "token.testnet",
        "escrow.testnet",
        "owner.testnet",
        "player.testnet",
        "treasury.testnet",
    ] {
        sandbox
            .create_account(name.parse()?)
            .initial_balance(NearToken::from_near(10))
            .send()
            .await?;
    }
    let owner: AccountId = "owner.testnet".parse()?;
    let restricted_key = near_api::signer::generate_secret_key()?;
    let restricted_signer = near_api::Signer::from_secret_key(restricted_key.clone())?;
    near_api::Account(owner.clone())
        .add_key(
            AccessKeyPermission::FunctionCall(FunctionCallPermission {
                allowance: Some(NearToken::from_near(1)),
                receiver_id: "escrow.testnet".to_string(),
                method_names: vec!["approve".to_string()],
            }),
            restricted_signer.get_public_key().await?,
        )
        .with_signer(signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    for (name, path, args) in [
        (
            "token.testnet",
            root.join("../compute-credit/target/near/compute_credit.wasm"),
            json!({"issuer":"owner.testnet"}),
        ),
        (
            "escrow.testnet",
            root.join("target/near/redemption_escrow.wasm"),
            json!({"token":"token.testnet","owner":"owner.testnet","treasury":"treasury.testnet","cap":"1"}),
        ),
    ] {
        near_api::Contract::deploy(name.parse()?)
            .use_code(std::fs::read(path)?)
            .with_init_call("new", args)?
            .with_signer(signer.clone())
            .send_to(&network)
            .await?
            .assert_success();
    }
    let token = near_api::Account("token.testnet".parse()?).as_contract();
    for account in ["player.testnet", "escrow.testnet", "treasury.testnet"] {
        token
            .call_function(
                "storage_deposit",
                json!({"account_id":account,"registration_only":true}),
            )
            .transaction()
            .deposit(NearToken::from_millinear(2))
            .with_signer(owner.clone(), signer.clone())
            .send_to(&network)
            .await?
            .assert_success();
    }
    token
        .call_function(
            "mint",
            json!({"account_id":"player.testnet","amount":"10000000"}),
        )
        .transaction()
        .deposit(NearToken::from_yoctonear(1))
        .with_signer(owner, signer)
        .send_to(&network)
        .await?
        .assert_success();
    let status = std::process::Command::new("bun")
        .arg("apps/server/test/escrow-sandbox-journey.ts")
        .current_dir(root.join("../.."))
        .env("SANDBOX_RPC", &sandbox.rpc_addr)
        .env("SANDBOX_OWNER_KEY", restricted_key.to_string())
        .env("SANDBOX_PLAYER_KEY", genesis)
        .status()?;
    assert!(status.success(), "Sandbox gateway journey failed");
    Ok(())
}
