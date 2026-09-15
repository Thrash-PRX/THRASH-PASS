const DEFAULTS = { provider: 'gemini', model: 'gemini-3.8-flash', endpoint: '', apiKey: '', presentationMode: false };
const GEMINI_FALLBACK_STATUS = new Set([404, 408, 429, 500, 502, 503, 504]);
const FETCH_TIMEOUT_MS = 25000;
const GEMINI_TOTAL_ATTEMPT_BUDGET = 6;
const GEMINI_RECOVERY_MS = 90000;
const CONNECTION_TEST_TIMEOUT_MS = 10000;

async function cfg() {
  const s = await chrome.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...s };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function retryAfterMs(response) {
  const raw = response.headers.get('retry-after');
  if (!raw) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const when = Date.parse(raw);
  return Number.isFinite(when) ? Math.max(0, when - Date.now()) : 0;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s.`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function geminiGenerateOnce(apiKey, model, prompt, imageDataUrl = null, timeoutMs = FETCH_TIMEOUT_MS) {
  const parts = [{ text: prompt }];
  if (imageDataUrl) {
    const m = imageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (m) parts.push({ inline_data: { mime_type: m[1], data: m[2] } });
  }

  const r = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts }] })
    }, timeoutMs
  );

  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data?.error?.message || `Gemini error ${r.status}`);
    err.status = r.status;
    err.code = data?.error?.status || data?.error?.code;
    err.retryAfterMs = retryAfterMs(r);
    throw err;
  }

  const answer = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  if (!answer) {
    const finishReason = data?.candidates?.[0]?.finishReason;
    throw new Error(finishReason ? `Gemini returned no text response (${finishReason}).` : 'Gemini returned no text response.');
  }
  return answer;
}

function recoveryModels(models) {
  // Automatically select general-purpose Flash models; avoid specialist/output-image models.
  return models.filter(m => /^gemini-/.test(m) && /flash/.test(m) &&
    !/image|tts|audio|live|native|robotics|computer-use/.test(m))
    .sort((a,b) => Number(/preview|exp/.test(a))-Number(/preview|exp/.test(b)) ||
      Number(/lite/.test(a))-Number(/lite/.test(b)) || b.localeCompare(a, undefined, {numeric:true}));
}

async function geminiGenerateWithFallback(apiKey, requestedModel, prompt, imageDataUrl = null, progress = () => {}, guard = async () => {}) {
  const deadline = Date.now() + GEMINI_RECOVERY_MS;
  const candidates = [requestedModel];
  const retired = new Set();
  let discovered = false, lastError, next = 0;
  for (let attempt = 0; attempt < GEMINI_TOTAL_ATTEMPT_BUDGET; attempt++) {
    await guard();
    if (Date.now() >= deadline || !candidates.length) break;
    const model = candidates[next++ % candidates.length];
    progress(`Trying ${model} (${attempt+1}/${GEMINI_TOTAL_ATTEMPT_BUDGET})…`);
    try {
      const answer = await geminiGenerateOnce(apiKey, model, prompt, imageDataUrl,
        Math.min(FETCH_TIMEOUT_MS, deadline-Date.now()));
      await guard();
      progress(`Answered by ${model}${model !== requestedModel ? ' (automatic fallback)' : ''}.`);
      return answer;
    } catch (error) {
      lastError = error;
      if (!GEMINI_FALLBACK_STATUS.has(error.status)) throw error;
      if (error.status === 404) retired.add(model);
      if (attempt + 1 >= GEMINI_TOTAL_ATTEMPT_BUDGET) break;
      // Discover once after failure, rather than spending attempts on hard-coded model IDs.
      if (!discovered && Date.now() < deadline) {
        discovered = true;
        progress('Checking available Gemini models…');
        try {
          const available = recoveryModels(await listGeminiModels(apiKey, deadline));
          candidates.push(...available.filter(m => !candidates.includes(m) && !retired.has(m)));
        } catch (_) { /* Keep retrying the selected model if discovery is unavailable. */ }
      }
      const remaining = candidates.filter(m => !retired.has(m));
      candidates.splice(0, candidates.length, ...remaining);
      if (!candidates.length) break;
      next = candidates.includes(model) ? candidates.indexOf(model)+1 : 0;
      const waitMs = error.status === 404 ? 0 : Math.max(error.retryAfterMs || 0,
        Math.min(12000, 1500 * 2 ** attempt) + Math.floor(Math.random()*300));
      if (Date.now()+waitMs >= deadline) break; // Never shorten a provider Retry-After delay.
      if(waitMs) progress(`Gemini is busy. Retrying in ${Math.ceil(waitMs/1000)} seconds…`);
      const until = Date.now()+waitMs;
      while(Date.now()<until) { await sleep(Math.min(1000,until-Date.now())); await guard(); }
    }
  }
  throw new Error(`Gemini automatic recovery stopped. ${lastError?.status === 429 ? 'The provider reported a rate or quota limit.' : 'The available models are still busy or unavailable.'} Please try again later. Last error: ${lastError?.message || 'Recovery time limit reached.'}`);
}

async function listGeminiModels(apiKey, deadline = Date.now()+25000) {
  if (!apiKey) throw new Error('Add an API key first.');
  const models = [], seen = new Set();
  let pageToken = '';
  do {
    if(Date.now() >= deadline) throw new Error('Model discovery timed out.');
    const url = new URL('https://generativelanguage.googleapis.com/v1beta/models');
    url.searchParams.set('key', apiKey);
    url.searchParams.set('pageSize', '1000');
    if(pageToken) url.searchParams.set('pageToken', pageToken);
    const r = await fetchWithTimeout(url.toString(), {}, Math.min(10000,deadline-Date.now()));
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data?.error?.message || `Gemini models error ${r.status}`);
    models.push(...(data.models || []).filter(m => m.supportedGenerationMethods?.includes('generateContent'))
      .map(m => m.name?.replace(/^models\//, '')).filter(Boolean));
    pageToken = data.nextPageToken || '';
    if(seen.has(pageToken)) throw new Error('Repeated model-list page token.');
    seen.add(pageToken);
  } while(pageToken);
  return [...new Set(models)];
}

async function readResponseJson(r, label) {
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error?.message || `${label} error ${r.status}`);
  return data;
}

async function callAI(prompt, imageDataUrl = null, progress = () => {}, guard = async () => {}) {
  const c = await cfg();
  if (!c.apiKey) throw new Error('Add an API key in THRASH-PASS settings.');
  if (!prompt.trim()) throw new Error('Enter a request first.');

  const provider = c.provider;
  if (imageDataUrl && !['gemini', 'openai'].includes(provider)) {
    throw new Error('Screenshot requests are supported with Gemini or OpenAI. Choose one of these providers.');
  }
  if (c.endpoint && provider !== 'gemini') {
    let endpoint;
    try { endpoint = new URL(c.endpoint); } catch (_) { throw new Error('Enter a valid endpoint URL.'); }
    if (!['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
      throw new Error('Use an HTTP(S) endpoint without credentials in the URL.');
    }
  }

  if (provider === 'gemini') {
    return geminiGenerateWithFallback(c.apiKey, c.model || DEFAULTS.model, prompt, imageDataUrl, progress, guard);
  }

  if (provider === 'openai') {
    const content = [{ type: 'text', text: prompt }];
    if (imageDataUrl) content.push({ type: 'image_url', image_url: { url: imageDataUrl } });
    const r = await fetchWithTimeout(c.endpoint || 'https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.apiKey}` },
      body: JSON.stringify({ model: c.model || 'gpt-4o-mini', messages: [{ role: 'user', content }] })
    });
    const data = await readResponseJson(r, 'OpenAI');
    return data?.choices?.[0]?.message?.content || 'No response received.';
  }

  if (provider === 'kimi') {
    const r = await fetchWithTimeout(c.endpoint || 'https://api.moonshot.cn/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.apiKey}` },
      body: JSON.stringify({ model: c.model || 'moonshot-v1-8k', messages: [{ role: 'user', content: prompt }] })
    });
    const data = await readResponseJson(r, 'Kimi');
    return data?.choices?.[0]?.message?.content || 'No response received.';
  }

  if (provider === 'custom') {
    if (!c.endpoint) throw new Error('Enter a custom OpenAI-compatible endpoint.');
    const r = await fetchWithTimeout(c.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.apiKey}` },
      body: JSON.stringify({ model: c.model, messages: [{ role: 'user', content: prompt }] })
    });
    const data = await readResponseJson(r, 'API');
    return data?.choices?.[0]?.message?.content || data?.output || JSON.stringify(data);
  }

  throw new Error('Unknown provider.');
}

async function testConnection() {
  const c = await cfg();
  if (!c.apiKey) throw new Error('Add an API key first.');
  if (c.provider === 'gemini') {
    try {
      const answer = await geminiGenerateOnce(c.apiKey, c.model || DEFAULTS.model,
        'Reply with exactly: THRASH-PASS OK', null, CONNECTION_TEST_TIMEOUT_MS);
      return answer;
    } catch (error) {
      if (error.status === 400) throw new Error(`Gemini rejected the request: ${error.message}`);
      if (error.status === 401 || error.status === 403) throw new Error('Gemini rejected this API key. Check the key and its API access.');
      if (error.status === 404) throw new Error(`Gemini model "${c.model || DEFAULTS.model}" is unavailable for this key. Click Refresh Gemini models and select one from the list.`);
      if (error.status === 429) throw new Error('Gemini rate limit or free-tier quota reached. Check Google AI Studio quota or try again later.');
      if ([500, 502, 503, 504].includes(error.status)) throw new Error('Gemini is temporarily overloaded. The key may still be valid; try again later.');
      throw error;
    }
  }
  return callAI('Reply with exactly: THRASH-PASS OK');
}

async function createContextMenus() {
  const { presentationMode = false } = await chrome.storage.local.get({ presentationMode: false });
  chrome.contextMenus.removeAll(() => {
    if (presentationMode) return;
    chrome.contextMenus.create({ id: 'thrash-ask', title: 'Ask THRASH-PASS about selection', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'thrash-page', title: 'Ask THRASH-PASS about this page', contexts: ['page'] });
  });
}

chrome.runtime.onInstalled.addListener(() => { createContextMenus().catch(() => {}); });
chrome.runtime.onStartup.addListener(() => { createContextMenus().catch(() => {}); });
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.presentationMode) createContextMenus().catch(() => {});
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  const { presentationMode = false } = await chrome.storage.local.get({ presentationMode: false });
  if (presentationMode) return;
  const text = info.selectionText || '';
  chrome.tabs.sendMessage(tab.id, { action: 'openAssistant', text }).catch(() => {});
});

chrome.commands.onCommand.addListener(async command => {
  if (command !== 'ask-selection') return;
  const { presentationMode = false } = await chrome.storage.local.get({ presentationMode: false });
  if (presentationMode) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { action: 'askSelection' }).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'syncPresentationMode') {
    createContextMenus()
      .then(() => sendResponse({ ok: true }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (msg.action === 'askAI') {
    cfg().then(c => {
      if (c.presentationMode) throw new Error('Presentation Mode is on. Page requests are disabled.');
      const progress = text => {
        if (sender.tab?.id) chrome.tabs.sendMessage(sender.tab.id, { action: 'aiProgress', text }, {frameId: 0}).catch(() => {});
      };
      const guard = async () => {
        const current = await cfg();
        if(current.presentationMode) throw new Error('Presentation Mode is on. Automatic recovery stopped.');
        if(current.apiKey !== c.apiKey || current.provider !== c.provider) throw new Error('Provider settings changed. Please submit again.');
      };
      return callAI(String(msg.prompt || ''), msg.imageDataUrl || null, progress, guard);
    })
      .then(answer => sendResponse({ ok: true, answer }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (msg.action === 'captureTab') {
    cfg().then(c => {
      if (c.presentationMode) throw new Error('Presentation Mode is on. Screenshot capture is disabled.');
      if (!sender.tab?.id) throw new Error('Could not identify the requesting page.');
      return chrome.tabs.query({ active: true, windowId: sender.tab.windowId }).then(([active]) => {
        if (active?.id !== sender.tab.id) throw new Error('Return to the requesting tab before capturing.');
        return chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' });
      });
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
    testConnection()
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
        if (!(el instanceof Element) || el.matches(':disabled, [readonly]')) return false;
        if (el.matches('textarea, [contenteditable=""], [contenteditable="true"], [role="textbox"]')) return true;
        if (el.matches('input')) {
          const type = (el.getAttribute('type') || 'text').toLowerCase();
          return ['text', 'search', 'url', 'tel'].includes(type);
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
  const results = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    world: 'MAIN',
    args: [text, mode],
    func: async (text, mode) => {
      const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
      const isEditable = el => {
        if (!(el instanceof Element) || el.matches(':disabled, [readonly]')) return false;
        if (el.matches('textarea, [contenteditable=""], [contenteditable="true"], [role="textbox"]')) return true;
        if (el.matches('input')) {
          const type = (el.getAttribute('type') || 'text').toLowerCase();
          return ['text', 'search', 'url', 'tel'].includes(type);
        }
        return false;
      };

      const marked = [...document.querySelectorAll('[data-thrash-pass-target="1"]')]
        .filter(isEditable)
        .sort((a, b) => Number(b.getAttribute('data-thrash-pass-target-at') || 0) - Number(a.getAttribute('data-thrash-pass-target-at') || 0));
      const active = isEditable(document.activeElement) ? document.activeElement : null;
      const target = marked[0] || active;
      if (!target) return { ok: false, error: 'No editable field was selected.' };

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
            const selection = editor.getSelection();
            editor.executeEdits('thrash-pass', [{ range: selection, text: chunk, forceMoveMarkers: true }]);
            if (pause) await delay(pause);
          }
          return { ok: true, target: 'Monaco editor' };
        }
      }

      const cm5Root = target.closest?.('.CodeMirror');
      const cm5 = cm5Root?.CodeMirror;
      if (cm5) {
        cm5.focus();
        for (const chunk of chunks) {
          cm5.replaceSelection(chunk, 'end', '+input');
          if (pause) await delay(pause);
        }
        return { ok: true, target: 'CodeMirror editor' };
      }

      const aceRoot = target.closest?.('.ace_editor');
      if (aceRoot && window.ace?.edit) {
        const editor = window.ace.edit(aceRoot);
        editor.focus();
        for (const chunk of chunks) {
          editor.insert(chunk);
          if (pause) await delay(pause);
        }
        return { ok: true, target: 'Ace editor' };
      }

      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        target.focus();
        for (const chunk of chunks) {
          const start = Number.isInteger(target.selectionStart) ? target.selectionStart : target.value.length;
          const end = Number.isInteger(target.selectionEnd) ? target.selectionEnd : start;
          target.setRangeText(chunk, start, end, 'end');
          target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: chunk }));
          if (pause) await delay(pause);
        }
        target.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, target: target.tagName.toLowerCase() };
      }

      if (target.isContentEditable || target.getAttribute('role') === 'textbox') {
        target.focus();
        for (const chunk of chunks) {
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
            } else {
              return { ok: false, error: 'Place the cursor inside the destination editor and try again.' };
            }
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
