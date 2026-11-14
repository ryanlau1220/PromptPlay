"""Smoke-test the wallet-free demo against a running PromptPlay web app."""
import os

from playwright.sync_api import expect, sync_playwright

web = os.environ.get("BROWSER_TEST_WEB_URL", "http://localhost:3000")
profiles = [(390, 844, "reduce"), (1366, 768, "no-preference")]

with sync_playwright() as playwright:
    for width, height, motion in profiles:
        with playwright.chromium.launch() as browser:
            page = browser.new_page(
                viewport={"width": width, "height": height}, reduced_motion=motion
            )
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(web)
            expect(page.get_by_role("heading", name="Play while your coding agent runs.")).to_be_visible()
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
            page.get_by_role("button", name="Claim", exact=True).click()
            expect(page.get_by_text("10 PCC claimed", exact=True)).to_be_visible()
            page.get_by_role("button", name="Next games").click()
            page.wait_for_function("document.querySelector('#story-game-gallery').scrollLeft > 0")
            page.get_by_role("link", name="Play the wallet-free demo").click()
            expect(page.get_by_role("heading", name="Practice the compute loop")).to_be_visible()
            assert page.evaluate("scrollY === 0")
            page.get_by_role("button", name="Paper", exact=True).click()
            page.get_by_role("button", name="Rock", exact=True).click()
            page.get_by_role("button", name="Claim simulated payout").click()
            page.get_by_role("button", name="Redeem 5 simulated PCC").click()
            page.get_by_role("button", name="Run a mock inference request").click()
            expect(page.get_by_text("0.999994 units", exact=True)).to_be_visible()
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
            assert not errors, errors
            print(f"{width}px ({motion}): wallet-free demo passed")
