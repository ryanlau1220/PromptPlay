use base64::{Engine, engine::general_purpose::STANDARD};
use near_api::{AccountId, NearGas, NearToken};
use near_sdk::serde_json::{Value, json};
use sha2::{Digest, Sha256};

#[tokio::test]
#[ignore = "waits for the real five-minute contract deadlines"]
async fn timeout_payouts_use_real_sandbox_timestamps() -> testresult::TestResult<()> {
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
    let bob: AccountId = "bob.sandbox".parse()?;
    for recipient in ["alice.sandbox", "bob.sandbox"] {
        token
            .call_function("mint", json!({"account_id":recipient,"amount":"100"}))
            .transaction()
            .deposit(NearToken::from_yoctonear(1))
            .with_signer(alice.clone(), signer.clone())
            .send_to(&network)
            .await?
            .assert_success();
    }
    for id in 0..4u64 {
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
        let participants = if id == 0 {
            vec![alice.clone()]
        } else {
            vec![alice.clone(), bob.clone()]
        };
        for who in participants {
            token.call_function("ft_transfer_call",json!({"receiver_id":"game.sandbox","amount":"10","memo":null,"msg":id.to_string()})).transaction().gas(NearGas::from_tgas(100)).deposit(NearToken::from_yoctonear(1)).with_signer(who,signer.clone()).send_to(&network).await?.assert_success();
        }
        if id > 0 {
            let committers = if id == 1 {
                vec![alice.clone()]
            } else {
                vec![alice.clone(), bob.clone()]
            };
            for who in committers {
                let mut data = b"PromptPlay:RPS:v1".to_vec();
                for part in [game_id.as_bytes(), who.as_bytes()] {
                    data.extend_from_slice(&(part.len() as u32).to_le_bytes());
                    data.extend_from_slice(part);
                }
                data.extend_from_slice(&id.to_le_bytes());
                data.extend_from_slice(&1u32.to_le_bytes());
                data.push(0);
                data.extend_from_slice(&[7u8; 32]);
                game.call_function("commit_move",json!({"match_id":id.to_string(),"commitment":STANDARD.encode(Sha256::digest(data))})).transaction().with_signer(who,signer.clone()).send_to(&network).await?.assert_success();
            }
        }
        if id == 2 {
            game.call_function(
                "reveal_move",
                json!({"match_id":"2","choice":0,"secret":STANDARD.encode([7u8;32])}),
            )
            .transaction()
            .with_signer(alice.clone(), signer.clone())
            .send_to(&network)
            .await?
            .assert_success();
        }
        game.call_function("resolve_timeout", json!({"match_id":id.to_string()}))
            .transaction()
            .with_signer(alice.clone(), signer.clone())
            .send_to(&network)
            .await?
            .assert_failure();
    }
    // Compare against the sandbox's block clock, not the host clock.
    let mut deadline = 0u64;
    for id in 0..4u64 {
        let state: Value = game
            .call_function("get_match", json!({"match_id":id.to_string()}))
            .read_only()
            .fetch_from(&network)
            .await?
            .data;
        deadline = deadline.max(state["deadline"].as_str().unwrap().parse::<u64>()?);
    }
    let started = std::time::Instant::now();
    loop {
        let block = near_api::Chain::block().fetch_from(&network).await?;
        let timestamp = block.header.timestamp_nanosec.parse::<u64>()?;
        if timestamp >= deadline {
            break;
        }
        assert!(
            started.elapsed() < std::time::Duration::from_secs(600),
            "Sandbox block clock did not reach deadline"
        );
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
    }
    for id in 0..4u64 {
        game.call_function("resolve_timeout", json!({"match_id":id.to_string()}))
            .transaction()
            .with_signer(alice.clone(), signer.clone())
            .send_to(&network)
            .await?
            .assert_success();
        let state: Value = game
            .call_function("get_match", json!({"match_id":id.to_string()}))
            .read_only()
            .fetch_from(&network)
            .await?
            .data;
        let (a, b, phase) = match id {
            0 => ("10", "0", "Cancelled"),
            1 => ("10", "10", "Cancelled"),
            2 => ("20", "0", "Completed"),
            _ => ("10", "10", "Cancelled"),
        };
        assert_eq!(state["phase"], phase);
        assert_eq!(state["players"][0]["claim"], a);
        assert_eq!(state["players"][1]["claim"], b);
        for (who, claim) in [(alice.clone(), a), (bob.clone(), b)] {
            if claim != "0" {
                game.call_function("claim_payout", json!({"match_id":id.to_string()}))
                    .transaction()
                    .gas(NearGas::from_tgas(70))
                    .deposit(NearToken::from_yoctonear(1))
                    .with_signer(who, signer.clone())
                    .send_to(&network)
                    .await?
                    .assert_success();
            }
        }
    }
    for (who, expected) in [
        ("alice.sandbox", "110"),
        ("bob.sandbox", "90"),
        ("game.sandbox", "0"),
    ] {
        let balance: String = token
            .call_function("ft_balance_of", json!({"account_id":who}))
            .read_only()
            .fetch_from(&network)
            .await?
            .data;
        assert_eq!(balance, expected);
    }
    Ok(())
}
