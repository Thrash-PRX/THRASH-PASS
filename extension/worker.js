const DEFAULTS = {
  provider: 'gemini',
  model: 'gemini-3.8-flash',
  endpoint: '',
  apiKey: '',
  presentationMode: false
};

// Ordered for reliability/latency after the user's preferred model.
const GEMINI_FALLBACK_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash'
];

const TRANSIENT_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const FALLBACK_STATUS = new Set([404, 408, 429, 500, 502, 503, 504]);

// 45 seconds was too aggressive for thinking/multimodal requests and, worse,
// client-side timeouts were not classified as retryable. Give the server a
// realistic deadline, then fail over cleanly if it still cannot answer.
const REQUEST_TIMEOUT_MS = 120000;
const MODEL_TIMEOUT_MS = 90000;
const GEMINI_TOTAL_ATTEMPT_BUDGET = 5;

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

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error(`The AI request exceeded ${Math.round(timeoutMs / 1000)} seconds. Trying another model may help.`);
      timeoutError.name = 'AIRequestTimeoutError';
      timeoutError.status = 408;
      timeoutError.code = 'CLIENT_TIMEOUT';
      timeoutError.transient = true;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function geminiGenerationConfig(model) {
  const config = { maxOutputTokens: 8192 };

  // Gemini 3 models support thinkingLevel. Low is a much better fit for an
  // interactive browser helper and greatly reduces first-token latency.
  if (/^gemini-3(?:\.|-)/.test(model)) {
    config.thinkingConfig = { thinkingLevel: 'low' };
  }

  return config;
}

async function geminiGenerateOnce(apiKey, model, prompt, imageDataUrl = null, timeoutMs = MODEL_TIMEOUT_MS) {
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
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: geminiGenerationConfig(model)
      })
    },
    timeoutMs
  );

  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data?.error?.message || `Gemini error ${r.status}`);
    err.status = r.status;
    err.code = data?.error?.status || data?.error?.code;
    err.retryAfterMs = retryAfterMs(r);
    err.transient = TRANSIENT_STATUS.has(r.status) || err.status === 408;
    throw err;
  }

  const answer = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  if (!answer) {
    const finishReason = data?.candidates?.[0]?.finishReason;
    throw new Error(finishReason ? `Gemini returned no text response (${finishReason}).` : 'Gemini returned no text response.');
  }
  return answer;
}

async function geminiGenerateWithFallback(apiKey, requestedModel, prompt, imageDataUrl = null, progress = () => {}) {
  const candidates = [requestedModel, ...GEMINI_FALLBACK_MODELS.filter(m => m !== requestedModel)];
  let lastError;

  for (let attempt = 0; attempt < Math.min(GEMINI_TOTAL_ATTEMPT_BUDGET, candidates.length); attempt++) {
    const model = candidates[attempt];
    progress(`Trying ${model} (${attempt + 1}/${Math.min(GEMINI_TOTAL_ATTEMPT_BUDGET, candidates.length)})…`);
    try {
      const answer = await geminiGenerateOnce(apiKey, model, prompt, imageDataUrl);
      if (model !== requestedModel) progress(`Answered by ${model} (fallback).`);
      return answer;
    } catch (error) {
      lastError = error;
      if (!FALLBACK_STATUS.has(error.status) && !error.transient) throw error;
      if (attempt + 1 >= GEMINI_TOTAL_ATTEMPT_BUDGET) break;
      const waitMs = error.status === 404 ? 0 : Math.max(error.retryAfterMs || 0, Math.min(8000, 1200 * 2 ** attempt) + Math.floor(Math.random() * 250));
      if (waitMs) {
        progress(`Gemini is busy. Retrying in ${Math.ceil(waitMs / 1000)}s…`);
        await sleep(waitMs);
      }
    }
  }
  throw new Error(`Gemini recovery stopped. ${lastError?.status === 429 ? 'Rate or quota limit.' : 'Models still busy or unavailable.'} Last error: ${lastError?.message || 'time limit'}`);
}

async function listGeminiModels(apiKey) {
  if (!apiKey) throw new Error('Add an API key first.');
  const models = [];
  let pageToken = '';
  do {
    const url = new URL('https://generativelanguage.googleapis.com/v1beta/models');
    url.searchParams.set('key', apiKey);
    url.searchParams.set('pageSize', '1000');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const r = await fetchWithTimeout(url.toString(), {}, 15000);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data?.error?.message || `Gemini models error ${r.status}`);
    models.push(...(data.models || []).filter(m => m.supportedGenerationMethods?.includes('generateContent')).map(m => m.name?.replace(/^models\//, '')).filter(Boolean));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return [...new Set(models)];
}

async function readResponseJson(r, label) {
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error?.message || `${label} error ${r.status}`);
  return data;
}

async function callAI(prompt, imageDataUrl = null, progress = () => {}) {
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
    return geminiGenerateWithFallback(c.apiKey, c.model || DEFAULTS.model, prompt, imageDataUrl, progress);
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
        if (sender.tab?.id) chrome.tabs.sendMessage(sender.tab.id, { action: 'aiProgress', text }, { frameId: 0 }).catch(() => {});
      };
      return callAI(String(msg.prompt || ''), msg.imageDataUrl || null, progress);
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
      if (!target) return { ok: false, error: 'Click the destination input/editor once, then try again.' };

      const pause = mode === 'type' ? 18 : 0;
      const chunks = mode === 'type' ? text.split('') : [text];

      const monaco = target.closest?.('.monaco-editor');
      if (monaco && window.monaco?.editor) {
        const editors = window.monaco.editor.getEditors?.() || [];
        const editor = editors.find(e => e.getDomNode?.()?.contains(target) || e.getDomNode?.() === monaco) || editors[0];
        if (editor) {
          editor.focus();
          for (const chunk of chunks) {
            editor.trigger('keyboard', 'type', { text: chunk });
            if (pause) await delay(pause);
          }
          return { ok: true, target: 'Monaco editor' };
        }
      }

      const cm5 = target.closest?.('.CodeMirror')?.CodeMirror;
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
            if (selection?.rangeCount) {
              const range = selection.getRangeAt(0);
              range.deleteContents();
              const node = document.createTextNode(chunk);
              range.insertNode(node);
              range.setStartAfter(node);
              range.collapse(true);
              selection.removeAllRanges();
              selection.addRange(range);
              target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: chunk }));
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
