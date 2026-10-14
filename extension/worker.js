importScripts('settings.js');
const DEFAULTS = TP_SETTINGS.defaults;
const TRANSIENT_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const REQUEST_TIMEOUT_MS = 25000;

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
  if (!['openFromPopup', 'syncPresentationMode', 'askAI', 'captureTab', 'listGeminiModels', 'testAI', 'insertIntoPage'].includes(msg.action)) return;
  const respond = sendResponse;
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo().catch(() => {}), 20000);
  const deadline = setTimeout(() => {
    responded = true;
    clearInterval(keepAlive);
    respond({ ok: false, error: 'Operation timed out. Please try a smaller request.' });
  }, 240000);
  let responded = false;
  sendResponse = value => {
    if (responded) return;
    responded = true;
    clearInterval(keepAlive);
    clearTimeout(deadline);
    respond(value);
  };
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
