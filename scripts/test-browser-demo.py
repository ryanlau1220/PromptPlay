"""Smoke-test the wallet-free demo against a running PromptPlay web app."""
import os

from playwright.sync_api import expect, sync_playwright

web = os.environ.get("BROWSER_TEST_WEB_URL", "http://localhost:3000")
profiles = [(320, 700, "reduce", True), (390, 844, "reduce", False), (1366, 768, "no-preference", False)]

with sync_playwright() as playwright:
    for width, height, motion, light in profiles:
        with playwright.chromium.launch() as browser:
            page = browser.new_page(
                viewport={"width": width, "height": height}, reduced_motion=motion
            )
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(web)
            expect(page.get_by_role("heading", name="Play while your coding agent runs.")).to_be_visible()
            if light:
                page.get_by_role("button", name="Switch to light mode").click()
                expect(page.locator("html")).to_have_attribute("data-theme", "light")
                page.reload()
                expect(page.locator("html")).to_have_attribute("data-theme", "light")
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), f"Landing overflow at {width}px"
            page.get_by_role("button", name="Claim", exact=True).click()
            expect(page.get_by_text("10 PCC claimed", exact=True)).to_be_visible()
            if motion == "no-preference":
                expand = page.get_by_role("button", name="Expand workspace")
                if expand.is_visible():
                    expand.click()
                    page.get_by_role("button", name="Exit fullscreen").click()
                    expect(expand).to_be_visible()
                    print("Workspace fullscreen enter and exit passed")
            page.get_by_role("button", name="Next games").click()
            page.wait_for_function("document.querySelector('#story-game-gallery').scrollLeft > 0")
            page.get_by_role("link", name="Play the wallet-free demo").click()
            expect(page.get_by_role("heading", name="Practice the compute loop")).to_be_visible()
            assert page.evaluate("scrollY === 0")
            skip = page.get_by_role("button", name="Skip to content")
            skip.focus()
            skip.press("Enter")
            expect(page.locator("#arcade-content")).to_be_focused()
            assert page.evaluate("location.hash === '#compute-demo'")
            page.get_by_role("button", name="Paper", exact=True).click()
            page.get_by_role("button", name="Rock", exact=True).click()
            page.get_by_role("button", name="Claim simulated payout").click()
            page.get_by_role("button", name="Redeem 5 simulated PCC").click()
            page.get_by_role("button", name="Run a mock inference request").click()
            expect(page.get_by_text("0.999994 units", exact=True)).to_be_visible()
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
            expect(page.get_by_role("heading", name="Mock request complete")).to_be_focused()
            page.get_by_text("Simulate redemption demand", exact=True).click()
            slider = page.get_by_role("slider")
            slider.press("End")
            expect(page.get_by_text("50 requests unmet", exact=False)).to_be_visible()
            page.get_by_role("button", name="Restart demo").click()
            expect(page.get_by_role("heading", name="Choose your move")).to_be_focused()
            page.get_by_role("link", name="Open Testnet duel").click()
            expect(page.get_by_role("heading", name="Enter Duel Arena")).to_be_visible()
            page.goto(web.split("#", 1)[0] + "#practice/tic-tac-toe")
            expect(page.get_by_role("heading", name="Tic-Tac-Toe")).to_be_visible()
            corner = page.get_by_role("button", name="Row 1, column 1: empty")
            corner.click()
            expect(page.get_by_text("Computer took the center.", exact=True)).to_be_visible()
            page.get_by_role("button", name="Restart", exact=True).click()
            expect(corner).to_be_enabled()
            page.get_by_text("About Testnet agreement rooms", exact=True).click()
            page.get_by_role("link", name="Open Testnet agreement room").click()
            expect(page.get_by_role("button", name="Connect NEAR Wallet")).to_be_visible()
            page.goto(web.split("#", 1)[0] + "#practice/sequence")
            expect(page.get_by_role("heading", name="Sequence")).to_be_visible()
            page.get_by_role("button", name="Show sequence").click()
            lit = page.locator(".sequence-pad.lit")
            expect(lit).to_be_visible()
            first_pad = lit.get_attribute("aria-label")
            expect(page.get_by_text("Round 1 · Repeat the sequence")).to_be_visible()
            page.get_by_role("button", name="Replay sequence").click()
            expect(lit).to_have_attribute("aria-label", first_pad)
            page.get_by_role("button", name=first_pad).click()
            expect(page.get_by_text("Round 2 ready")).to_be_visible()
            page.goto(web.split("#", 1)[0] + "#practice/2048")
            expect(page.get_by_role("heading", name="2048")).to_be_visible()
            assert page.evaluate("""() => {
                const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
                document.querySelector('.practice-page h1').dispatchEvent(event)
                return !event.defaultPrevented
            }""")
            move = page.get_by_role("button", name="Move down")
            move.focus()
            assert page.evaluate("""() => {
                const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
                document.activeElement.dispatchEvent(event)
                return event.defaultPrevented
            }""")
            assert not errors, errors
            print(f"{width}px ({motion}): wallet-free demo passed")
