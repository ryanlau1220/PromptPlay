use base64::{Engine, engine::general_purpose::STANDARD};
use near_api::{AccountId, NearGas, NearToken};
use near_sdk::serde_json::{Value, json};
use sha2::{Digest, Sha256};

#[tokio::test]
async fn escrow_settles_a_two_player_tie() -> testresult::TestResult<()> {
    let sandbox = near_sandbox::Sandbox::start_sandbox().await?;
    let network = near_api::NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let signer = near_api::Signer::from_secret_key(
        near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?,
    )?;
    for name in [
        "token.sandbox",
        "game.sandbox",
        "alice.sandbox",
        "bob.sandbox",
    ] {
        sandbox
            .create_account(name.parse()?)
            .initial_balance(NearToken::from_near(10))
            .send()
            .await?;
    }
    let token_id: AccountId = "token.sandbox".parse()?;
    let game_id: AccountId = "game.sandbox".parse()?;
    let alice: AccountId = "alice.sandbox".parse()?;
    let token = near_api::Account(token_id.clone()).as_contract();
    let game = near_api::Account(game_id.clone()).as_contract();
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    for (id, file, args) in [
        (
            token_id.clone(),
            "compute_credit.wasm",
            json!({"issuer":"alice.sandbox"}),
        ),
        (
            game_id.clone(),
            "rps_game.wasm",
            json!({"token":"token.sandbox"}),
        ),
    ] {
        near_api::Contract::deploy(id)
            .use_code(std::fs::read(if file == "compute_credit.wasm" {
                root.join("../compute-credit/target/near").join(file)
            } else {
                root.join("target/near").join(file)
            })?)
            .with_init_call("new", args)?
            .with_signer(signer.clone())
            .send_to(&network)
            .await?
            .assert_success();
    }
    for account in ["alice.sandbox", "bob.sandbox", "game.sandbox"] {
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
        .call_function("mint", json!({"account_id":"alice.sandbox","amount":"100"}))
        .transaction()
        .deposit(NearToken::from_yoctonear(1))
        .with_signer(alice.clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    game.call_function(
        "create_match",
        json!({"opponent":"bob.sandbox","stake":"10"}),
    )
    .transaction()
    .deposit(NearToken::from_millinear(10))
    .with_signer(alice.clone(), signer.clone())
    .send_to(&network)
    .await?
    .assert_success();
    token
        .call_function(
            "ft_transfer_call",
            json!({"receiver_id":"game.sandbox","amount":"10","memo":null,"msg":"0"}),
        )
        .transaction()
        .gas(NearGas::from_tgas(100))
        .deposit(NearToken::from_yoctonear(1))
        .with_signer(alice.clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    let bal: String = token
        .call_function("ft_balance_of", json!({"account_id":"game.sandbox"}))
        .read_only()
        .fetch_from(&network)
        .await?
        .data;
    assert_eq!(bal, "10");
    token
        .call_function("mint", json!({"account_id":"bob.sandbox","amount":"10"}))
        .transaction()
        .deposit(NearToken::from_yoctonear(1))
        .with_signer(alice.clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    let bob: AccountId = "bob.sandbox".parse()?;
    token
        .call_function(
            "ft_transfer_call",
            json!({"receiver_id":"game.sandbox","amount":"10","memo":null,"msg":"0"}),
        )
        .transaction()
        .gas(NearGas::from_tgas(100))
        .deposit(NearToken::from_yoctonear(1))
        .with_signer(bob.clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    for who in [alice.clone(), bob.clone()] {
        let mut data = b"PromptPlay:RPS:v1".to_vec();
        for part in [game_id.as_bytes(), who.as_bytes()] {
            data.extend_from_slice(&(part.len() as u32).to_le_bytes());
            data.extend_from_slice(part);
        }
        data.extend_from_slice(&0u64.to_le_bytes());
        data.extend_from_slice(&1u32.to_le_bytes());
        data.push(0);
        data.extend_from_slice(&[7u8; 32]);
        let hash = STANDARD.encode(Sha256::digest(data));
        game.call_function("commit_move", json!({"match_id":"0","commitment":hash}))
            .transaction()
            .with_signer(who, signer.clone())
            .send_to(&network)
            .await?
            .assert_success();
    }
    for who in [alice.clone(), bob.clone()] {
        game.call_function(
            "reveal_move",
            json!({"match_id":"0","choice":0,"secret":STANDARD.encode([7u8;32])}),
        )
        .transaction()
        .with_signer(who, signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    }
    // External callers must not be able to spoof the payout callback.
    game.call_function(
        "on_payout",
        json!({"match_id":"0","player":1,"amount":"10"}),
    )
    .transaction()
    .with_signer(alice.clone(), signer.clone())
    .send_to(&network)
    .await?
    .assert_failure();
    // Force a real FT transfer failure: Bob unregisters after depositing his entire balance.
    token
        .call_function("storage_unregister", json!({"force":false}))
        .transaction()
        .deposit(NearToken::from_yoctonear(1))
        .with_signer(bob.clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    game.call_function("claim_payout", json!({"match_id":"0"}))
        .transaction()
        .gas(NearGas::from_tgas(70))
        .deposit(NearToken::from_yoctonear(1))
        .with_signer(bob.clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    let failed: Value = game
        .call_function("get_match", json!({"match_id":"0"}))
        .read_only()
        .fetch_from(&network)
        .await?
        .data;
    assert_eq!(failed["players"][1]["claim"], "10");
    assert_eq!(failed["players"][1]["pending"], false);
    token
        .call_function(
            "storage_deposit",
            json!({"account_id":"bob.sandbox","registration_only":true}),
        )
        .transaction()
        .deposit(NearToken::from_millinear(2))
        .with_signer(bob.clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    game.call_function("claim_payout", json!({"match_id":"0"}))
        .transaction()
        .gas(NearGas::from_tgas(70))
        .deposit(NearToken::from_yoctonear(1))
        .with_signer(bob.clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    let bob_balance: String = token
        .call_function("ft_balance_of", json!({"account_id":"bob.sandbox"}))
        .read_only()
        .fetch_from(&network)
        .await?
        .data;
    assert_eq!(bob_balance, "10");
    game.call_function("claim_payout", json!({"match_id":"0"}))
        .transaction()
        .gas(NearGas::from_tgas(70))
        .deposit(NearToken::from_yoctonear(1))
        .with_signer(alice.clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    let balance: String = token
        .call_function("ft_balance_of", json!({"account_id":"alice.sandbox"}))
        .read_only()
        .fetch_from(&network)
        .await?
        .data;
    assert_eq!(balance, "100");
    let m: Value = game
        .call_function("get_match", json!({"match_id":"0"}))
        .read_only()
        .fetch_from(&network)
        .await?
        .data;
    assert_eq!(m["players"][0]["claim"], "0");
    assert_eq!(m["players"][0]["pending"], false);
    Ok(())
}
