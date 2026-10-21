import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { chromium } from 'playwright';

// This test uses only a temporary extension copy and disposable browser profile.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'thrash-pass-reload-'));
const extension = path.join(root, 'extension');
const profile = path.join(root, 'profile');
const results = [];
let context;
const server = http.createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html');
  response.end('<h1>THRASH-PASS isolated reload test</h1><textarea id="editor">Keep this unsaved text</textarea>');
});
function check(condition, description) {
  assert.ok(condition, description);
  results.push(description);
  console.log('PASS: ' + description);
}
async function panelState(worker) {
  return worker.evaluate(async () => {
    const [tab] = await ordinaryTabs();
    return chrome.tabs.sendMessage(tab.id, { action: 'getReloadState' }, { frameId: 0 });
  });
}
async function closePanel(page) {
  // DevTools can inspect our closed shadow root so the test clicks the real close control.
  const cdp = await page.context().newCDPSession(page);
  try {
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const find = node => {
      if (node.attributes?.includes('thrash-pass-root')) return node;
      for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) {
        const match = find(child);
        if (match) return match;
      }
    };
    const host = find(root);
    const shadow = await cdp.send('DOM.resolveNode', { backendNodeId: host.shadowRoots[0].backendNodeId });
    await cdp.send('Runtime.callFunctionOn', {
      objectId: shadow.object.objectId,
      functionDeclaration: 'function() { this.querySelector(".x").click(); }'
    });
  } finally { await cdp.detach(); }
}
try {
  await fs.cp(path.resolve('extension'), extension, { recursive: true });
  const original = JSON.parse(await fs.readFile(path.join(extension, 'manifest.json'), 'utf8'));
  const newerVersion = original.version.split('.').map((part, index) => index === 2 ? Number(part) + 1 : part).join('.');
  await fs.mkdir(path.join(profile, 'Default'), { recursive: true });
  // Match the documented initial setup: Developer mode must already be enabled.
  await fs.writeFile(path.join(profile, 'Default', 'Preferences'), JSON.stringify({ extensions: { ui: { developer_mode: true } } }));
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.THRASH_TEST_CHROMIUM ? { executablePath: process.env.THRASH_TEST_CHROMIUM } : { channel: 'chromium' }),
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension]
  });
  // Chromium protects this preference; exercise the documented Developer mode UI,
  // rather than relying only on a Preferences file written by the test harness.
  const manager = await context.newPage();
  await manager.goto('chrome://extensions');
  const developerMode = manager.locator('extensions-toolbar #devMode');
  if (!(await developerMode.evaluate(toggle => toggle.checked))) await developerMode.click();
  check(await developerMode.evaluate(toggle => toggle.checked), 'Developer mode is enabled during the initial setup');
  await manager.close();
  let worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:' + server.address().port);
  await page.locator('#thrash-pass-root').waitFor({ state: 'attached' });
  check(await worker.evaluate(() => chrome.runtime.getManifest().version) === original.version, 'Initial extension version is loaded');
  check(await page.locator('#thrash-pass-root').count() === 1, 'Initial page has one assistant root');
  const alarm = await worker.evaluate(() => chrome.alarms.get(LOCAL_UPDATE_ALARM));
  check(alarm?.periodInMinutes === 1, 'Local file watcher runs every minute');
  await worker.evaluate(async () => {
    await chrome.storage.local.set({ apiKey: 'sandbox-test-sentinel', model: 'saved-test-model' });
    const [tab] = await ordinaryTabs();
    await chrome.tabs.sendMessage(tab.id, { action: 'openAssistant', text: 'Keep my open draft' }, { frameId: 0 });
  });
  check((await panelState(worker)).busy, 'Open draft marks the assistant as busy');

  const stage = path.join(root, 'staged-extension');
  await fs.cp(extension, stage, { recursive: true });
  original.version = newerVersion;
  await fs.writeFile(path.join(stage, 'manifest.json'), JSON.stringify(original));
  await fs.rename(extension, path.join(root, 'previous-extension'));
  await fs.rename(stage, extension);
  check(await worker.evaluate(() => checkForLocalUpdate()) === false, 'First observation stages the update without reloading');
  check(await worker.evaluate(() => checkForLocalUpdate()) === false, 'Open assistant defers the automatic reload');
  check(await worker.evaluate(() => chrome.runtime.getManifest().version) !== newerVersion, 'Old runtime stays active while a draft is open');
  await closePanel(page);
  check(!(await panelState(worker)).busy, 'Closing the panel makes the extension idle');
  let navigations = 0;
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
  const nextWorker = context.waitForEvent('serviceworker', { timeout: 30000 });
  // Accelerate only the real alarm's next tick; never invoke runtime.reload() from the test.
  await worker.evaluate(() => chrome.alarms.create(LOCAL_UPDATE_ALARM, { delayInMinutes: 0.03, periodInMinutes: 1 }));
  worker = await nextWorker;
  await page.locator('#thrash-pass-root').waitFor({ state: 'attached' });
  check(await worker.evaluate(() => chrome.runtime.getManifest().version) === newerVersion, 'Alarm reloads the extension into the newer version automatically');
  check(await page.locator('#editor').inputValue() === 'Keep this unsaved text', 'Unsaved webpage text survives the reload');
  check(navigations === 0, 'Webpage is not refreshed during the extension update');
  check(await page.locator('#thrash-pass-root').count() === 1, 'Open page reconnects with exactly one assistant root');
  const settings = await worker.evaluate(() => chrome.storage.local.get(['apiKey', 'model']));
  check(settings.apiKey === 'sandbox-test-sentinel' && settings.model === 'saved-test-model', 'Saved extension settings survive the reload');
  check(await worker.evaluate(() => checkForLocalUpdate()) === false, 'Matching local version does not cause a reload loop');
  await worker.evaluate(async () => {
    const [tab] = await ordinaryTabs();
    await chrome.tabs.sendMessage(tab.id, { action: 'openAssistant', text: 'Ready after update' }, { frameId: 0 });
  });
  check((await panelState(worker)).busy, 'Assistant works on the already-open page after the update');
  await fs.mkdir('output/playwright', { recursive: true });
  await fs.writeFile('output/playwright/auto-reload-results.json', JSON.stringify({ browser: context.browser().version(), checks: results }, null, 2));
  console.log('All ' + results.length + ' isolated Chromium checks passed.');
} catch (error) {
  console.error('Browser version:', context?.browser().version());
  if (context) {
    const diagnostic = await context.newPage();
    await diagnostic.goto('chrome://extensions');
    console.error(await diagnostic.locator('body').ariaSnapshot());
  }
  throw error;
} finally {
  await context?.close();
  if (server.listening) await new Promise(resolve => server.close(resolve));
  const expectedPrefix = path.join(os.tmpdir(), 'thrash-pass-reload-');
  if (!path.resolve(root).startsWith(expectedPrefix)) throw new Error('Unexpected temporary test path.');
  await fs.rm(root, { recursive: true, force: true });
}
