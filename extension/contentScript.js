(async () => {
  const { presentationMode = false } = await chrome.storage.local.get({ presentationMode: false });
  if (presentationMode) return;

  const TARGET_ATTR = 'data-thrash-pass-target';
  const TARGET_TIME_ATTR = 'data-thrash-pass-target-at';
  let markedTarget = null;

  function isEditable(el) {
    if (!(el instanceof Element) || el.matches(':disabled, [readonly]')) return false;
    if (el.matches('textarea, [contenteditable=""], [contenteditable="true"], [role="textbox"]')) return true;
    if (el.matches('input')) {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      return ['text', 'search', 'url', 'tel'].includes(type);
    }
    return false;
  }

  function markTarget(el) {
    if (!isEditable(el)) return;
    if (el.id === 'thrash-pass-root' || el.closest?.('#thrash-pass-root')) return;
    try {
      if (markedTarget && markedTarget !== el) {
        markedTarget.removeAttribute(TARGET_ATTR);
        markedTarget.removeAttribute(TARGET_TIME_ATTR);
      }
      markedTarget = el;
      el.setAttribute(TARGET_ATTR, '1');
      el.setAttribute(TARGET_TIME_ATTR, String(Date.now()));
    } catch (_) {}
  }

  document.addEventListener('focusin', event => markTarget(event.target), true);
  document.addEventListener('pointerdown', event => {
    const candidate = event.target?.closest?.('textarea, input, [contenteditable=""], [contenteditable="true"], [role="textbox"]');
    if (candidate) markTarget(candidate);
  }, true);

  // Child frames only need target tracking. The visible assistant lives in the top frame.
  if (window.top !== window) return;

  const id = 'thrash-pass-root';
  if (document.getElementById(id)) return;

  const root = document.createElement('div');
  root.id = id;
  const shadow = root.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
    .tp{position:fixed;right:18px;bottom:18px;width:380px;max-width:calc(100vw - 36px);max-height:76vh;background:#101014;color:#fff;border:1px solid #333;border-radius:14px;z-index:2147483647;box-shadow:0 10px 40px #0008;font:14px system-ui;display:none;overflow:hidden}
    .head{padding:12px 14px;font-weight:700;border-bottom:1px solid #29292f;display:flex;justify-content:space-between}.x{cursor:pointer}.body{padding:12px}.q{width:100%;box-sizing:border-box;background:#18181d;color:#fff;border:1px solid #38383f;border-radius:9px;padding:10px;resize:vertical;min-height:90px}.row{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}.b{border:0;border-radius:8px;padding:9px 12px;cursor:pointer;background:#fff;color:#111;font:inherit}.b.secondary{background:#27272d;color:#fff}.b.accent{background:#d8ff56;color:#101014;font-weight:700}.b:disabled{opacity:.55;cursor:not-allowed}.ans{white-space:pre-wrap;background:#17171c;border-radius:9px;padding:10px;margin-top:10px;max-height:32vh;overflow:auto}.mini{font-size:11px;opacity:.65;margin-top:7px}.status{font-size:12px;margin-top:8px;min-height:16px;color:#cfcfd6}.tools[hidden]{display:none}@media(max-width:520px){.tp{right:10px;bottom:10px;width:calc(100vw - 20px);max-width:none}.b{flex:1}}
  `;
  shadow.append(style);

  const box = document.createElement('div');
  box.className = 'tp';
  box.innerHTML = `<div class="head"><span>THRASH-PASS</span><span class="x">×</span></div><div class="body"><textarea class="q" placeholder="Ask anything about the selected text or page..."></textarea><div class="row"><button class="b ask">Ask AI</button><button class="b secondary shot">Screenshot</button></div><div class="mini">Uses the provider configured in the extension.</div><div class="ans" hidden></div><div class="row tools" hidden><button class="b accent paste">Paste code</button><button class="b secondary type">Auto-type</button><button class="b secondary copy">Copy</button></div><div class="status"></div></div>`;
  shadow.append(box);
  document.documentElement.append(root);

  const q = shadow.querySelector('.q');
  const ans = shadow.querySelector('.ans');
  const askButton = shadow.querySelector('.ask');
  const shotButton = shadow.querySelector('.shot');
  const tools = shadow.querySelector('.tools');
  const pasteButton = shadow.querySelector('.paste');
  const typeButton = shadow.querySelector('.type');
  const copyButton = shadow.querySelector('.copy');
  const status = shadow.querySelector('.status');

  function pageText() {
    return document.body?.innerText?.slice(0, 12000) || '';
  }

  function open(text = '') {
    box.style.display = 'block';
    q.value = text || window.getSelection()?.toString() || '';
    status.textContent = '';
    q.focus();
  }

  function setBusy(busy) {
    askButton.disabled = busy;
    shotButton.disabled = busy;
    askButton.textContent = busy ? 'Thinking…' : 'Ask AI';
  }

  function extractInsertText(raw) {
    const text = String(raw || '');
    const fenced = text.match(/```(?:[a-zA-Z0-9_+.#-]+)?\s*\n([\s\S]*?)```/);
    return (fenced ? fenced[1] : text).replace(/^\n+|\n+$/g, '');
  }

  async function ask(imageDataUrl = null) {
    const question = q.value.trim();
    if (!question) {
      ans.hidden = false;
      ans.textContent = 'Type a request first.';
      tools.hidden = true;
      return;
    }

    ans.hidden = false;
    ans.textContent = 'Thinking…';
    tools.hidden = true;
    status.textContent = '';
    setBusy(true);

    try {
      const prompt = `You are THRASH-PASS, a helpful browser AI assistant. Answer the user's request accurately and concisely. If the user asks for code, put the final code in one fenced code block so it can be inserted into the page cleanly.\n\nUser request:\n${question}\n\nRelevant page text:\n${pageText()}`;
      const r = await chrome.runtime.sendMessage({ action: 'askAI', prompt, imageDataUrl });
      if (r?.ok) {
        ans.textContent = r.answer;
        tools.hidden = false;
      } else {
        ans.textContent = `Error: ${r?.error || 'Request failed'}`;
      }
    } catch (error) {
      ans.textContent = `Error: ${error.message || 'Request failed'}`;
    } finally {
      setBusy(false);
    }
  }

  async function insertAnswer(mode) {
    const text = extractInsertText(ans.textContent);
    if (!text) {
      status.textContent = 'Nothing to insert yet.';
      return;
    }

    pasteButton.disabled = true;
    typeButton.disabled = true;
    status.textContent = mode === 'type' ? 'Auto-typing into the last focused editor…' : 'Pasting into the last focused editor…';

    try {
      const r = await chrome.runtime.sendMessage({ action: 'insertIntoPage', text, mode });
      if (r?.ok) {
        status.textContent = `${mode === 'type' ? 'Auto-typed' : 'Inserted'} into ${r.target || 'the page editor'} ✓`;
      } else {
        status.textContent = r?.error || 'Click the page input/editor once, then press Paste code or Auto-type again.';
      }
    } catch (error) {
      status.textContent = `Insert failed: ${error.message}`;
    } finally {
      pasteButton.disabled = false;
      typeButton.disabled = false;
    }
  }

  async function copyAnswer() {
    const text = extractInsertText(ans.textContent);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = 'Code copied ✓';
    } catch (_) {
      const temp = document.createElement('textarea');
      temp.value = text;
      temp.style.position = 'fixed';
      temp.style.opacity = '0';
      document.documentElement.append(temp);
      temp.select();
      document.execCommand('copy');
      temp.remove();
      status.textContent = 'Code copied ✓';
    }
  }

  shadow.querySelector('.x').onclick = () => { box.style.display = 'none'; };
  askButton.onclick = () => ask();
  pasteButton.onclick = () => insertAnswer('paste');
  typeButton.onclick = () => insertAnswer('type');
  copyButton.onclick = copyAnswer;

  shotButton.onclick = async () => {
    ans.hidden = false;
    ans.textContent = 'Capturing screenshot…';
    tools.hidden = true;
    setBusy(true);
    try {
      const r = await chrome.runtime.sendMessage({ action: 'captureTab' });
      if (r?.ok) await ask(r.dataUrl);
      else ans.textContent = `Screenshot error: ${r?.error || 'failed'}`;
    } catch (error) {
      ans.textContent = `Screenshot error: ${error.message || 'failed'}`;
    } finally {
      setBusy(false);
    }
  };

  q.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') ask();
  });

  chrome.runtime.onMessage.addListener(msg => {
    if (msg.action === 'openAssistant') open(msg.text);
    if (msg.action === 'askSelection') open(window.getSelection()?.toString() || '');
  });
})();
