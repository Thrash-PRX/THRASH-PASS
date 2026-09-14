const $ = id => document.getElementById(id);
const DEFAULTS = { provider: 'gemini', apiKey: '', model: 'gemini-3.8-flash', endpoint: '', presentationMode: false };

async function load() {
  const s = await chrome.storage.local.get(DEFAULTS);
  $('provider').value = s.provider;
  $('apiKey').value = s.apiKey;
  $('model').value = s.model;
  $('endpoint').value = s.endpoint;
  $('presentationMode').checked = !!s.presentationMode;
  toggleProviderFields();
}

function toggleProviderFields() {
  const gemini = $('provider').value === 'gemini';
  $('model').placeholder = gemini ? 'gemini-3.8-flash' : 'Provider model ID';
  $('endpoint').disabled = gemini;
  $('endpoint').placeholder = gemini ? 'Not used for Gemini' : 'https://.../v1/chat/completions';
  $('refreshModels').disabled = !gemini;
}

function currentSettings() {
  const provider = $('provider').value;
  return {
    provider,
    apiKey: $('apiKey').value.trim(),
    model: $('model').value.trim() || (provider === 'gemini' ? 'gemini-3.8-flash' : ''),
    endpoint: $('endpoint').value.trim(),
    presentationMode: $('presentationMode').checked
  };
}

async function saveSettings(showStatus = true) {
  const settings = currentSettings();
  await chrome.storage.local.set(settings);
  if (showStatus) $('status').textContent = 'Saved.';
  return settings;
}

async function withBusy(button, busyText, task) {
  const oldText = button.textContent;
  button.disabled = true;
  button.textContent = busyText;
  try {
    return await task();
  } catch (error) {
    $('status').textContent = `Error: ${error.message || 'Operation failed'}`;
  } finally {
    button.disabled = false;
    button.textContent = oldText;
    toggleProviderFields();
  }
}

$('presentationMode').addEventListener('change', async () => {
  await chrome.storage.local.set({ presentationMode: $('presentationMode').checked });
  $('status').textContent = $('presentationMode').checked
    ? 'Presentation Mode ON. THRASH-PASS will be inactive on webpages. Refresh already-open pages once.'
    : 'Presentation Mode OFF. Refresh already-open pages to enable THRASH-PASS again.';
  chrome.runtime.sendMessage({ action: 'syncPresentationMode' }).catch(() => {});
});

$('provider').addEventListener('change', () => {
  const models = { gemini: DEFAULTS.model, openai: 'gpt-4o-mini', kimi: 'moonshot-v1-8k', custom: '' };
  $('model').value = models[$('provider').value];
  $('endpoint').value = '';
  $('apiKey').value = '';
  $('modelList').replaceChildren();
  $('status').textContent = 'Provider changed. Enter its API key and model, then save.';
  toggleProviderFields();
});

$('save').onclick = () => withBusy($('save'), 'Saving…', () => saveSettings(true));

$('test').onclick = async () => {
  await withBusy($('test'), 'Testing…', async () => {
    $('status').textContent = 'Testing current settings…';
    await saveSettings(false);
    const r = await chrome.runtime.sendMessage({ action: 'testAI' });
    $('status').textContent = r?.ok ? `Connected: ${r.answer}` : `Error: ${r?.error || 'failed'}`;
  });
};

$('refreshModels').onclick = async () => {
  await withBusy($('refreshModels'), 'Loading…', async () => {
    $('status').textContent = 'Loading available Gemini models…';
    await saveSettings(false);
    const r = await chrome.runtime.sendMessage({ action: 'listGeminiModels' });
    if (!r?.ok) {
      $('status').textContent = `Error: ${r?.error || 'failed'}`;
      return;
    }
    const models = r.models.filter(m => /^gemini-/.test(m));
    $('modelList').innerHTML = '';
    for (const m of models) {
      const o = document.createElement('option');
      o.value = m;
      $('modelList').appendChild(o);
    }
    $('status').textContent = `Found ${models.length} compatible Gemini models.`;
  });
};

load().catch(error => {
  $('status').textContent = `Load error: ${error.message}`;
});
