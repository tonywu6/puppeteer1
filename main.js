// @ts-check

import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import * as har from 'chrome-har'
import lighthouse, { desktopConfig } from 'lighthouse'
import puppeteer from 'puppeteer-core'

// === OPTIONS ===

/** @type {string} */
const executablePath = '/opt/homebrew/bin/chromium'

/** @type {URL} */
const targetUrl = new URL('https://vercel.com')

/** @type {string | null} */
const targetElement = 'div[class*="hero_triangle"] > svg > polygon'

// === OPTIONS ===

/** @param {string} msg */
const confirm = async (msg) => {
  console.log(msg)
  await new Promise((resolve) => process.stdin.once('data', resolve))
}

/**
 * @param {import('puppeteer-core').Page} page
 */
async function networkToHar(page) {
  /** @type {unknown[]} */
  const events = []

  const client = await page.createCDPSession()

  await client.send('Page.enable')
  await client.send('Network.enable')

  for (const event of [
    'Page.loadEventFired',
    'Page.domContentEventFired',
    'Page.frameStartedLoading',
    'Page.frameAttached',
    'Network.requestWillBeSent',
    'Network.requestServedFromCache',
    'Network.dataReceived',
    'Network.responseReceived',
    'Network.resourceChangedPriority',
    'Network.loadingFinished',
    'Network.loadingFailed',
  ]) {
    client.on(event, (params) => {
      events.push({ method: event, params })
    })
  }

  return async () => {
    await client.detach()
    return har.harFromMessages(events)
  }
}

const __dirname = path.dirname(new URL(import.meta.url).pathname)
const now = new Date().toISOString().replaceAll(/:/g, '-')
const outDir = path.join(__dirname, 'dist', targetUrl.hostname, now)

async function main() {
  await fs.mkdir(outDir, { recursive: true })

  const browser = await puppeteer.launch({
    executablePath,
    headless: false,
    // https://github.com/GoogleChrome/lighthouse/blob/main/docs/puppeteer.md
    ignoreDefaultArgs: ['--enable-automation'],
    defaultViewport: null,
  })

  const page = await browser.newPage()

  await page.setCacheEnabled(false)

  await page.goto(targetUrl.toString(), { waitUntil: 'domcontentloaded' })

  await confirm('Press any key to start profiling')

  await page.goto('about:blank', { waitUntil: 'networkidle0' })

  await page.bringToFront()

  const exportHar = await networkToHar(page)

  await page.tracing.start({
    path: path.join(outDir, 'trace.json'),
    screenshots: true,
  })

  await page.goto(targetUrl.toString(), { waitUntil: 'networkidle2' })

  if (targetElement) {
    await page.waitForSelector(targetElement)
  } else {
    await confirm('Press any key to stop profiling')
  }

  await page.tracing.stop()

  const harFile = await exportHar()

  await fs.writeFile(path.join(outDir, 'requests.har'), JSON.stringify(harFile))

  await page.goto('about:blank')

  const lhr = await lighthouse(
    targetUrl.toString(),
    undefined,
    desktopConfig,
    page,
  )

  await fs.writeFile(
    path.join(outDir, 'lighthouse.json'),
    JSON.stringify(lhr?.lhr),
  )

  await browser.close()
}

await main()

process.exit(0)
