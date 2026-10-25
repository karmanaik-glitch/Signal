"""
STRATA v3 Smoke UI — Playwright E2E test.
Tests all 5 main modules + Stock View + command palette + mobile layout.
Run: python tests/smoke_ui.py
"""
import asyncio, sys, threading, http.server, functools, json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP  = ROOT / 'app'

handler_base = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(APP))
class QuietHandler(handler_base.func):
    def log_message(self, *a): pass

# Use port 0 to get a random available port, avoiding conflicts
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(APP)))
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f'http://127.0.0.1:{PORT}/index.html'
print(f'Server started on port {PORT}')


# v3 routes to visit
V3_ROUTES = [
    'home',
    'signals',
    'watchlist',
    'rulebot',
    'more',
    'stock/TCS',       # unified stock view
    'stock/INFY',
    '__kit',           # component kit page
]

async def main():
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={'width': 1440, 'height': 900})
        errs = []
        page.on('pageerror', lambda e: errs.append('JS: ' + str(e)))
        page.on('console',   lambda m: errs.append('console: ' + m.text) if m.type == 'error' else None)

        await page.goto(BASE)
        # Wait for the app shell to be ready
        await page.wait_for_selector('#main > *', timeout=12000)
        print('Shell loaded OK')

        # Test all routes
        for route in V3_ROUTES:
            await page.evaluate(f"location.hash='#/{route}'")
            await page.wait_for_timeout(600)
            txt = await page.inner_text('#main')
            assert 'failed to render' not in txt.lower(), f'View render error at #{route}: {txt[:200]}'
            assert 'undefined' not in txt[:60], f'Undefined values at #{route}'
            print(f'{route:25} OK  ({len(txt)} chars)')

        # Test that data-stock navigation works
        await page.evaluate("location.hash='#/signals'")
        await page.wait_for_timeout(600)
        # Click a stock row if present
        first_stock = await page.query_selector('td[data-stock]')
        if first_stock:
            sym = await first_stock.get_attribute('data-stock')
            await first_stock.click()
            await page.wait_for_timeout(500)
            h = await page.evaluate("location.hash")
            assert 'stock' in h.lower(), f'Expected stock route after click, got {h}'
            print(f'Stock click nav      OK  (→ {h})')

        # Command palette
        await page.evaluate("location.hash='#/screener'")
        await page.wait_for_timeout(300)
        await page.keyboard.press('/')
        await page.wait_for_selector('#pal[open]', timeout=3000)
        await page.keyboard.type('tcs')
        await page.wait_for_timeout(200)
        pal_text = await page.inner_text('#palList')
        print(f'Palette              OK  ({pal_text[:80].replace(chr(10), " | ")})')
        await page.keyboard.press('Escape')

        # Mobile layout
        await page.set_viewport_size({'width': 390, 'height': 844})
        await page.evaluate("location.hash='#/home'")
        await page.wait_for_timeout(500)
        tabs_vis = await page.evaluate("getComputedStyle(document.getElementById('tabs')).display !== 'none'")
        rail_vis = await page.evaluate("getComputedStyle(document.getElementById('rail')).display !== 'none'")
        assert tabs_vis, 'Mobile tabs should be visible on 390px'
        assert not rail_vis, 'Desktop rail should be hidden on 390px'
        print(f'Mobile layout        OK  (tabs={tabs_vis}, rail={rail_vis})')

        # Theme toggle
        theme_before = await page.evaluate("document.documentElement.dataset.theme")
        await page.click('#themeBtn')
        theme_after = await page.evaluate("document.documentElement.dataset.theme")
        assert theme_before != theme_after, 'Theme toggle should change theme'
        print(f'Theme toggle         OK  ({theme_before} → {theme_after})')

        print()
        print(f'ERRORS: {errs[:8]}')
        await browser.close()

        if errs:
            print('FAIL — console errors detected')
            sys.exit(1)
        else:
            print('ALL SMOKE TESTS PASSED')

asyncio.run(main())
