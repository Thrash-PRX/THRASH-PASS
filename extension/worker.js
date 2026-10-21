importScripts('settings.js');
const DEFAULTS = TP_SETTINGS.defaults;
const TRANSIENT_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const REQUEST_TIMEOUT_MS = 25000;
const UPDATE_CHECK_ALARM = 'thrash-pass-update-check';
const UPDATE_CHECK_INTERVAL_MINUTES = 360;
const LOCAL_UPDATE_ALARM = 'thrash-pass-local-update';
let activeOperations = 0;
let reloadInProgress = false;
let lastOperationAt = 0;
const UPDATE_INFO_URL = 'https://raw.githubusercontent.com/Thrash-PRX/THRASH-PASS/main/update.json';
const UPDATE_PAGE_URL = 'https://github.com/Thrash-PRX/THRASH-PASS#update-thrash-pass';
const UPDATE_STATE_DEFAULTS = {
  updateAvailable: false,
  latestVersion: '',
  updatePageUrl: UPDATE_PAGE_URL,
  lastUpdateCheck: 0,
  lastUpdateError: '',
  lastNotifiedVersion: ''
};

async function cfg() {
  const s = await chrome.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...s };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Include response-body reading in the deadline, below Chrome's fetch limit.
async function requestJson(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...options, signal: controller.signal, redirect: 'error' });
    const raw = await r.text();
    let data;
    try { data = JSON.parse(raw); } catch {
      const error = new Error(r.ok ? 'The provider returned an invalid JSON response.' : 'Provider HTTP error ' + r.status);
      error.status = r.status;
      throw error;
    }
    if (!r.ok) {
      const error = new Error(data?.error?.message || 'Provider HTTP error ' + r.status);
      error.status = r.status;
      const retry = r.headers.get('retry-after');
      error.retryAfterMs = retry ? (Number.isFinite(Number(retry)) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now())) : 0;
      throw error;
    }
    return data;
  } catch (error) {
    if (controller.signal.aborted) {
      const timeout = new Error('The provider took too long to respond. Try again or choose a faster model.');
      timeout.status = 408;
      throw timeout;
    }
    if (error instanceof TypeError) {
      const network = new Error('Cannot reach the provider. Check your connection and endpoint.');
      network.status = 503;
      throw network;
    }
    throw error;
  } finally { clearTimeout(timer); }
}

async function listGeminiModels(apiKey) {
  if (!apiKey) throw new Error('Add an API key first.');
  const models = [];
  let pageToken = '';
  const seen = new Set();
  do {
    const url = new URL('https://generativelanguage.googleapis.com/v1beta/models');
    url.searchParams.set('pageSize', '1000');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const data = await requestJson(url.href, { headers: { 'x-goog-api-key': apiKey } });
    for (const m of data.models || []) {
      if (m.supportedGenerationMethods?.includes('generateContent') && m.name?.startsWith('models/gemini-')) models.push(m.name.slice(7));
    }
    pageToken = data.nextPageToken || '';
    if (seen.has(pageToken)) throw new Error('The provider repeated a model-list page. Try again.');
    seen.add(pageToken);
    if (pageToken && seen.size >= 5) throw new Error('Model discovery returned too many pages. Try again later.');
  } while (pageToken);
  return [...new Set(models)];
}

function modelRank(model) {
  return (/flash/.test(model) ? 0 : 10) + (/lite/.test(model) ? 0 : 1) + (/preview|experimental|exp-/.test(model) ? 3 : 0);
}

async function geminiGenerateOnce(apiKey, model, prompt, imageDataUrl) {
  const parts = [{ text: prompt }];
  if (imageDataUrl) {
    const m = imageDataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!m) throw new Error('Invalid screenshot data.');
    parts.push({ inline_data: { mime_type: m[1], data: m[2] } });
  }
  const data = await requestJson('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { maxOutputTokens: 8192 } })
  });
  const candidate = data.candidates?.[0];
  const answer = candidate?.content?.parts?.filter(p => !p.thought).map(p => p.text || '').join('');
  if (candidate?.finishReason === 'MAX_TOKENS') throw new Error('The answer exceeded the output limit. Ask for a smaller response; incomplete code was not inserted.');
  if (!answer?.trim()) throw new Error('Gemini returned no text (' + (data.promptFeedback?.blockReason || candidate?.finishReason || 'empty response') + ').');
  return answer;
}

function compareVersions(left, right) {
  const parse = value => {
    const [main, prerelease = ''] = String(value || '').trim().replace(/^v/i, '').split('-', 2);
    if (!/^\d+(?:\.\d+)*$/.test(main)) return null;
    return { parts: main.split('.').map(Number), prerelease };
  };
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) throw new Error('The update service returned an invalid version.');
  const length = Math.max(a.parts.length, b.parts.length);
  for (let i = 0; i < length; i++) {
    const difference = (a.parts[i] || 0) - (b.parts[i] || 0);
    if (difference) return Math.sign(difference);
  }
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease);
}

function trustedUpdatePage(value) {
  try {
    const url = new URL(value);
    const path = url.pathname.toLowerCase();
    if (url.protocol === 'https:' && url.hostname === 'github.com' && (path === '/thrash-prx/thrash-pass' || path.startsWith('/thrash-prx/thrash-pass/'))) return url.toString();
  } catch (_) {}
  return UPDATE_PAGE_URL;
}

async function fetchUpdateInfo() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(UPDATE_INFO_URL, { cache: 'no-store', headers: { Accept: 'application/json' }, redirect: 'error', signal: controller.signal });
    const raw = await response.text();
    if (!response.ok) throw new Error('Update service returned ' + response.status + '.');
    try { return JSON.parse(raw); }
    catch { throw new Error('The update service returned invalid data.'); }
  } catch (error) {
    if (controller.signal.aborted) throw new Error('The update check timed out.');
    throw error;
  } finally { clearTimeout(timer); }
}

async function setUpdateBadge(available) {
  await chrome.action.setBadgeBackgroundColor({ color: '#d8ff56' });
  await chrome.action.setBadgeText({ text: available ? 'NEW' : '' });
}

async function getUpdateStatus() {
  const state = await chrome.storage.local.get(UPDATE_STATE_DEFAULTS);
  return { ...UPDATE_STATE_DEFAULTS, ...state, currentVersion: chrome.runtime.getManifest().version };
}

async function checkForExtensionUpdate({ notify = false } = {}) {
  const previous = await getUpdateStatus();
  try {
    const info = await fetchUpdateInfo();
    const latestVersion = String(info?.version || '').trim().replace(/^v/i, '');
    const currentVersion = chrome.runtime.getManifest().version;
    const updateAvailable = compareVersions(latestVersion, currentVersion) > 0;
    const state = {
      updateAvailable,
      latestVersion,
      updatePageUrl: trustedUpdatePage(info?.page),
      lastUpdateCheck: Date.now(),
      lastUpdateError: ''
    };
    await chrome.storage.local.set(state);
    await setUpdateBadge(updateAvailable);
    if (notify && updateAvailable && previous.lastNotifiedVersion !== latestVersion) {
      await chrome.notifications.create('thrash-pass-update-' + latestVersion, {
        type: 'basic',
        iconUrl: 'images/icon128.png',
        title: 'THRASH-PASS update available',
        message: 'Version ' + latestVersion + ' is ready. Click to view the update guide.',
        priority: 1
      });
      await chrome.storage.local.set({ lastNotifiedVersion: latestVersion });
    }
    return { ...state, currentVersion };
  } catch (error) {
    await chrome.storage.local.set({ lastUpdateCheck: Date.now(), lastUpdateError: error.message });
    throw error;
  }
}

async function geminiGenerateWithFallback(apiKey, requestedModel, prompt, imageDataUrl = null) {
  let models = [];
  try { models = await listGeminiModels(apiKey); } catch (error) {
    if (!requestedModel || !TRANSIENT_STATUS.has(error.status)) throw error;
  }
  models = models.filter(m => !/image|tts|live|robotics|embedding/.test(m)).sort((a,b) => modelRank(a) - modelRank(b) || b.localeCompare(a, undefined, { numeric: true }));
  const candidates = [...new Set([requestedModel?.replace(/^models\//, ''), ...models].filter(Boolean))].slice(0, 3);
  if (!candidates.length) throw new Error('No text-generation Gemini model is available. Refresh models or enter a model ID.');
  let lastError;
  let attempts = 0;
  for (const model of candidates) {
    for (let retry = 0; retry < 2 && attempts < 4; retry++) {
      attempts++;
      try { return await geminiGenerateOnce(apiKey, model, prompt, imageDataUrl); } catch (error) {
        lastError = error;
        if (error.status === 404 || error.status === 408 || error.status === 504) break;
        if (!TRANSIENT_STATUS.has(error.status)) throw error;
        if (error.retryAfterMs > 5000) throw new Error(error.message + ' Wait before retrying.');
        if (retry === 0 && attempts < 4) await sleep(Math.max(800, error.retryAfterMs || 0));
      }
    }
    if (attempts >= 4) break;
  }
  throw new Error('Gemini request failed after ' + attempts + ' attempts. ' + (lastError?.message || 'No available model.'));
}

function validateEndpoint(endpoint) {
  let url;
  try { url = new URL(endpoint); } catch { throw new Error('Enter a valid API endpoint URL.'); }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Use an HTTPS endpoint (HTTP is allowed only for localhost).');
  if (url.username || url.password || url.hash) throw new Error('Remove credentials and fragments from the endpoint URL.');
  return url.href;
}

async function callAI(prompt, imageDataUrl = null) {
  const c = await cfg();
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('Enter a request first.');
  if (!c.apiKey?.trim()) throw new Error('Add an API key in THRASH-PASS settings.');
  if (!TP_SETTINGS.providers[c.provider]) throw new Error('Unknown provider.');
  if (c.provider === 'gemini') return geminiGenerateWithFallback(c.apiKey, c.model, prompt, imageDataUrl);
  const defaults = TP_SETTINGS.providers[c.provider];
  const model = c.model || defaults.model;
  if (!model) throw new Error('Enter a model ID for this provider.');
  const endpoint = validateEndpoint(c.endpoint || defaults.endpoint);
  // Never silently discard a screenshot for an incompatible provider.
  if (imageDataUrl && c.provider === 'kimi') throw new Error('Screenshot requests are not supported by this Kimi integration. Use Gemini or a vision-capable OpenAI-compatible model.');
  const content = imageDataUrl ? [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: imageDataUrl } }] : prompt;
  let data;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      data = await requestJson(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.apiKey }, body: JSON.stringify({ model, messages: [{ role: 'user', content }] }) });
      break;
    } catch (error) {
      if (attempt || !TRANSIENT_STATUS.has(error.status) || error.retryAfterMs > 5000) throw error;
      await sleep(Math.max(800, error.retryAfterMs || 0));
    }
  }
  if (data.choices?.[0]?.finish_reason === 'length') throw new Error('The answer was truncated. Ask for a smaller response.');
  const answer = data.choices?.[0]?.message?.content;
  if (typeof answer !== 'string' || !answer.trim()) throw new Error('The provider returned no text answer. Check the model and endpoint.');
  return answer;
}

let menuSync = Promise.resolve();
function createContextMenus() {
  menuSync = menuSync.catch(() => {}).then(async () => {
    const { presentationMode = false } = await chrome.storage.local.get({ presentationMode: false });
    await chrome.contextMenus.removeAll();
    if (presentationMode) return;
    chrome.contextMenus.create({ id: 'thrash-ask', title: 'Ask THRASH-PASS about selection', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'thrash-page', title: 'Ask THRASH-PASS about this page', contexts: ['page'] });
  });
  return menuSync;
}

async function initializeExtension() {
  await createContextMenus();
  chrome.alarms.create(UPDATE_CHECK_ALARM, { delayInMinutes: 1, periodInMinutes: UPDATE_CHECK_INTERVAL_MINUTES });
  chrome.alarms.create(LOCAL_UPDATE_ALARM, { delayInMinutes: 1, periodInMinutes: 1 });
  const status = await getUpdateStatus();
  await setUpdateBadge(status.updateAvailable);
  checkForExtensionUpdate({ notify: true }).catch(() => {});
}

async function ordinaryTabs() {
  return (await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] })).filter(tab => tab.id && /^https?:/.test(tab.url || ''));
}

async function restoreOpenTabs() {
  for (const tab of await ordinaryTabs()) {
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['contentScript.js'] }).catch(() => {});
  }
}

async function checkForLocalUpdate() {
  if (activeOperations || reloadInProgress || Date.now() - lastOperationAt < 1000) return false;
  if (chrome.runtime.getContexts && (await chrome.runtime.getContexts({ contextTypes: ['POPUP'] })).length) return false;
  const localResource = async path => {
    const response = await fetch(chrome.runtime.getURL(path) + '?updateCheck=' + Date.now(), { cache: 'no-store' });
    if (!response.ok) throw new Error('Installed update is not ready.');
    return response.text();
  };
  const manifest = JSON.parse(await localResource('manifest.json'));
  if (manifest.name !== 'THRASH-PASS' || manifest.manifest_version !== 3 || compareVersions(manifest.version, chrome.runtime.getManifest().version) <= 0) return false;
  // Require a complete package and two observations across alarm ticks. Persist the
  // candidate because Manifest V3 workers normally sleep between those ticks.
  for (const file of ['worker.js', 'settings.js', 'contentScript.js', 'popup.html']) {
    if (!(await localResource(file)).trim()) return false;
  }
  const { pendingLocalUpdate = '' } = await chrome.storage.local.get({ pendingLocalUpdate: '' });
  if (pendingLocalUpdate !== manifest.version) {
    await chrome.storage.local.set({ pendingLocalUpdate: manifest.version });
    return false;
  }
  const tabs = await ordinaryTabs();
  for (const tab of tabs) {
    const state = await chrome.tabs.sendMessage(tab.id, { action: 'getReloadState' }, { frameId: 0 }).catch(() => null);
    if (state?.busy) return false;
  }
  if (activeOperations || Date.now() - lastOperationAt < 1000) return false;
  reloadInProgress = true;
  try {
    for (const tab of tabs) {
      await chrome.tabs.sendMessage(tab.id, { action: 'prepareForReload' }).catch(() => {});
    }
    await chrome.storage.local.remove('pendingLocalUpdate');
    chrome.runtime.reload();
    return true;
  } catch (error) {
    reloadInProgress = false;
    throw error;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  initializeExtension().catch(() => {});
  restoreOpenTabs().catch(() => {});
});
chrome.runtime.onStartup.addListener(() => { initializeExtension().catch(() => {}); });
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.presentationMode) createContextMenus().catch(() => {});
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === UPDATE_CHECK_ALARM) checkForExtensionUpdate({ notify: true }).catch(() => {});
  if (alarm.name === LOCAL_UPDATE_ALARM) checkForLocalUpdate().catch(() => {});
});

chrome.notifications.onClicked.addListener(notificationId => {
  if (!notificationId.startsWith('thrash-pass-update-')) return;
  getUpdateStatus().then(status => chrome.tabs.create({ url: trustedUpdatePage(status.updatePageUrl) })).catch(() => {});
  chrome.notifications.clear(notificationId).catch(() => {});
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  const { presentationMode = false } = await chrome.storage.local.get({ presentationMode: false });
  if (presentationMode) return;
  const text = info.selectionText || '';
  openAssistant(tab.id, { action: 'openAssistant', text }).catch(() => {});
});

chrome.commands.onCommand.addListener(async command => {
  if (command !== 'ask-selection') return;
  const { presentationMode = false } = await chrome.storage.local.get({ presentationMode: false });
  if (presentationMode) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  openAssistant(tab.id, { action: 'askSelection' }).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.action !== 'string') return;
  if (!['getUpdateStatus', 'checkForUpdates', 'openFromPopup', 'syncPresentationMode', 'askAI', 'captureTab', 'listGeminiModels', 'testAI', 'insertIntoPage'].includes(msg.action)) return;
  if (reloadInProgress) { sendResponse({ ok: false, error: 'THRASH-PASS is applying an update. Try again in a moment.' }); return; }
  activeOperations++;
  lastOperationAt = Date.now();
  const respond = sendResponse;
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo().catch(() => {}), 20000);
  const deadline = setTimeout(() => {
    if (responded) return;
    responded = true;
    activeOperations--;
    lastOperationAt = Date.now();
    clearInterval(keepAlive);
    respond({ ok: false, error: 'Operation timed out. Please try a smaller request.' });
  }, 240000);
  let responded = false;
  sendResponse = value => {
    if (responded) return;
    responded = true;
    activeOperations--;
    lastOperationAt = Date.now();
    clearInterval(keepAlive);
    clearTimeout(deadline);
    respond(value);
  };
  if (msg.action === 'getUpdateStatus') {
    getUpdateStatus().then(status => sendResponse({ ok: true, ...status })).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (msg.action === 'checkForUpdates') {
    checkForExtensionUpdate().then(status => sendResponse({ ok: true, ...status })).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (msg.action === 'openFromPopup') {
    (async () => {
      if ((await cfg()).presentationMode) throw new Error('Turn off Presentation Mode first.');
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !/^https?:/.test(tab.url || '')) throw new Error('Open a normal HTTP or HTTPS webpage first. Browser settings and extension-store pages cannot be used.');
      await openAssistant(tab.id, { action: 'askSelection' });
      return { ok: true };
    })().then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (msg.action === 'syncPresentationMode') {
    createContextMenus()
      .then(() => sendResponse({ ok: true }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (msg.action === 'askAI') {
    cfg().then(c => { if (c.presentationMode) throw new Error('Presentation Mode is on.'); return callAI(msg.prompt || '', msg.imageDataUrl || null); })
      .then(answer => sendResponse({ ok: true, answer }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (msg.action === 'captureTab') {
    cfg().then(async c => {
      if (c.presentationMode) throw new Error('Presentation Mode is on. Screenshot capture is disabled.');
      if (!sender.tab?.id) throw new Error('Screenshot must be requested from a webpage.');
      const [active] = await chrome.tabs.query({ active: true, windowId: sender.tab.windowId });
      if (active?.id !== sender.tab.id) throw new Error('Return to the requesting tab before taking a screenshot.');
      return chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' });
    })
      .then(dataUrl => sendResponse({ ok: true, dataUrl }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (msg.action === 'listGeminiModels') {
    cfg().then(c => listGeminiModels(c.apiKey))
      .then(models => sendResponse({ ok: true, models }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (msg.action === 'testAI') {
    callAI('Reply with exactly: THRASH-PASS OK')
      .then(answer => sendResponse({ ok: true, answer }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (msg.action === 'insertIntoPage') {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ ok: false, error: 'Could not identify the active page.' });
      return;
    }
    const text = String(msg.text || '');
    const mode = msg.mode === 'type' ? 'type' : 'paste';
    cfg()
      .then(c => {
        if (c.presentationMode) return { blocked: true };
        return findInsertionTarget(tabId);
      })
      .then(target => {
        if (target?.blocked) return { ok: false, error: 'Presentation Mode is on. Page insertion is disabled.' };
        if (!target) return { ok: false, error: 'Click the destination input/editor once, then try again.' };
        return insertIntoTarget(tabId, target.frameId, text, mode);
      })
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});

async function findInsertionTarget(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: 'MAIN',
    func: () => {
      const isEditable = el => {
        if (!(el instanceof Element) || !el.isConnected || el.disabled || el.readOnly) return false;
        if (el.matches('textarea') || el.isContentEditable) return true;
        if (el.matches('input')) {
          const type = (el.getAttribute('type') || 'text').toLowerCase();
          return ['text', 'search', 'tel', 'url'].includes(type);
        }
        return false;
      };

      const marked = [...document.querySelectorAll('[data-thrash-pass-target="1"]')]
        .filter(isEditable)
        .sort((a, b) => Number(b.getAttribute('data-thrash-pass-target-at') || 0) - Number(a.getAttribute('data-thrash-pass-target-at') || 0));
      const active = isEditable(document.activeElement) ? document.activeElement : null;
      const target = marked[0] || active;
      if (!target) return { ok: false };

      const ts = Number(target.getAttribute('data-thrash-pass-target-at') || 0);
      let kind = target.tagName?.toLowerCase() || 'editor';
      if (target.closest?.('.monaco-editor')) kind = 'Monaco editor';
      else if (target.closest?.('.CodeMirror, .cm-editor')) kind = 'CodeMirror editor';
      else if (target.closest?.('.ace_editor')) kind = 'Ace editor';
      else if (target.isContentEditable) kind = 'contenteditable editor';
      return { ok: true, ts, kind };
    }
  });

  const candidates = results.filter(r => r.result?.ok);
  if (!candidates.length) return null;
  candidates.sort((a, b) => (b.result.ts || 0) - (a.result.ts || 0));
  return { frameId: candidates[0].frameId, kind: candidates[0].result.kind };
}

async function insertIntoTarget(tabId, frameId, text, mode) {
  if ((await cfg()).presentationMode) return { ok: false, error: 'Presentation Mode is on.' };
  try { await chrome.tabs.sendMessage(tabId, { action: 'restoreTargetSelection' }, { frameId }); } catch (_) {}
  const results = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    world: 'MAIN',
    args: [text, mode],
    func: async (text, mode) => {
      const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
      const isEditable = el => {
        if (!(el instanceof Element) || !el.isConnected || el.disabled || el.readOnly) return false;
        if (el.matches('textarea') || el.isContentEditable) return true;
        if (el.matches('input')) {
          const type = (el.getAttribute('type') || 'text').toLowerCase();
          return ['text', 'search', 'tel', 'url'].includes(type);
        }
        return false;
      };

      const marked = [...document.querySelectorAll('[data-thrash-pass-target="1"]')]
        .filter(isEditable)
        .sort((a, b) => Number(b.getAttribute('data-thrash-pass-target-at') || 0) - Number(a.getAttribute('data-thrash-pass-target-at') || 0));
      const active = isEditable(document.activeElement) ? document.activeElement : null;
      const target = marked[0] || active;
      if (!target) return { ok: false, error: 'No editable field was selected.' };

      const wasMarked = target.getAttribute('data-thrash-pass-target') === '1';
      const checkTarget = () => {
        if (!target.isConnected || target.disabled || target.readOnly || (wasMarked && target.getAttribute('data-thrash-pass-target') !== '1')) throw new Error('Insertion stopped because the target changed or Presentation Mode was enabled.');
      };

      const chunks = mode === 'type'
        ? (() => {
            const size = text.length > 6000 ? 12 : text.length > 2500 ? 6 : text.length > 800 ? 3 : 1;
            const out = [];
            for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
            return out;
          })()
        : [text];
      const pause = mode === 'type' ? (text.length > 2500 ? 2 : 5) : 0;

      const monacoRoot = target.closest?.('.monaco-editor');
      if (monacoRoot && window.monaco?.editor?.getEditors) {
        const editors = window.monaco.editor.getEditors();
        const editor = editors.find(e => e.getDomNode?.() === monacoRoot || e.getDomNode?.()?.contains(target)) || editors.find(e => e.hasTextFocus?.());
        if (editor) {
          editor.focus();
          for (const chunk of chunks) {
            checkTarget();
            const selection = editor.getSelection();
            const model = editor.getModel();
            if (!selection || !model || editor.getOption?.(window.monaco.editor.EditorOption?.readOnly)) return { ok: false, error: 'The Monaco editor is not editable.' };
            const offset = model.getOffsetAt({ lineNumber: selection.startLineNumber, column: selection.startColumn });
            if (editor.executeEdits('thrash-pass', [{ range: selection, text: chunk, forceMoveMarkers: true }]) === false) return { ok: false, error: 'Monaco rejected the edit.' };
            editor.setPosition(model.getPositionAt(offset + chunk.length));
            if (pause) await delay(pause);
          }
          return { ok: true, target: 'Monaco editor' };
        }
      }

      const cm5Root = target.closest?.('.CodeMirror');
      const cm5 = cm5Root?.CodeMirror;
      if (cm5) {
        cm5.focus();
        if (cm5.getOption('readOnly')) return { ok: false, error: 'The CodeMirror editor is read-only.' };
        for (const chunk of chunks) {
          checkTarget();
          cm5.replaceSelection(chunk, 'end', '+input');
          if (pause) await delay(pause);
        }
        return { ok: true, target: 'CodeMirror editor' };
      }

      const aceRoot = target.closest?.('.ace_editor');
      if (aceRoot && window.ace?.edit) {
        const editor = window.ace.edit(aceRoot);
        if (editor.getReadOnly()) return { ok: false, error: 'The Ace editor is read-only.' };
        editor.focus();
        for (const chunk of chunks) {
          checkTarget();
          editor.insert(chunk);
          if (pause) await delay(pause);
        }
        return { ok: true, target: 'Ace editor' };
      }

      if (target.closest('.monaco-editor, .CodeMirror, .cm-editor, .ace_editor')) return { ok: false, error: 'This code editor does not expose a supported insertion API. Use Copy, then paste into the editor.' };

      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        target.focus();
        for (const chunk of chunks) {
          checkTarget();
          const start = Number.isInteger(target.selectionStart) ? target.selectionStart : target.value.length;
          const end = Number.isInteger(target.selectionEnd) ? target.selectionEnd : start;
          const value = target.value.slice(0, start) + chunk + target.value.slice(end);
          const proto = target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(target, value);
          target.setSelectionRange(start + chunk.length, start + chunk.length);
          target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: chunk }));
          if (pause) await delay(pause);
        }
        target.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, target: target.tagName.toLowerCase() };
      }

      if (target.isContentEditable || target.getAttribute('role') === 'textbox') {
        target.focus();
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount || !target.contains(selection.getRangeAt(0).commonAncestorContainer)) {
          const range = document.createRange();
          range.selectNodeContents(target);
          range.collapse(false);
          selection?.removeAllRanges();
          selection?.addRange(range);
        }
        for (const chunk of chunks) {
          checkTarget();
          let inserted = false;
          try { inserted = document.execCommand('insertText', false, chunk); } catch (_) {}
          if (!inserted) {
            const selection = window.getSelection();
            if (selection?.rangeCount && target.contains(selection.getRangeAt(0).commonAncestorContainer)) {
              const range = selection.getRangeAt(0);
              range.deleteContents();
              const node = document.createTextNode(chunk);
              range.insertNode(node);
              range.setStartAfter(node);
              range.collapse(true);
              selection.removeAllRanges();
              selection.addRange(range);
              target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: chunk }));
            } else { return { ok: false, error: 'The editor did not accept insertion. Use Copy instead.' }; }
          }
          if (pause) await delay(pause);
        }
        return { ok: true, target: 'contenteditable editor' };
      }

      return { ok: false, error: 'The selected field is not editable.' };
    }
  });

  return results[0]?.result || { ok: false, error: 'Insert script did not return a result.' };
}

async function openAssistant(tabId, message) {
  try { await chrome.tabs.sendMessage(tabId, message, { frameId: 0 }); }
  catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['contentScript.js'] });
      await chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
    } catch { throw new Error('Cannot open the assistant on this page. Refresh a normal webpage and try again.'); }
  }
}
