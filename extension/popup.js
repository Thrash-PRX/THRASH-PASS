const $ = id => document.getElementById(id);
const DEFAULTS = TP_SETTINGS.defaults;
let profiles = {};
let selectedProvider = DEFAULTS.provider;
let busy = false;
function currentProfile() {
  return { apiKey: $('apiKey').value.trim(), model: $('model').value.trim(), endpoint: $('endpoint').value.trim() };
}
function toggleProviderFields() {
  const gemini = $('provider').value === 'gemini';
  $('model').placeholder = gemini ? 'Automatic: discover available models' : TP_SETTINGS.providers[$('provider').value].model || 'Required model ID';
  $('endpoint').disabled = gemini || busy;
  $('endpoint').placeholder = gemini ? 'Not used for Gemini' : TP_SETTINGS.providers[$('provider').value].endpoint || 'https://.../v1/chat/completions';
  $('refreshModels').disabled = !gemini || busy;
}
function showProfile(provider) {
  const p = profiles[provider] || { ...TP_SETTINGS.providers[provider], apiKey: '' };
  for (const field of ['apiKey', 'model', 'endpoint']) $(field).value = p[field] || '';
  $('modelList').replaceChildren();
  toggleProviderFields();
}
async function load() {
  const s = await chrome.storage.local.get({ ...DEFAULTS, providerProfiles: {} });
  profiles = s.providerProfiles || {};
  selectedProvider = TP_SETTINGS.providers[s.provider] ? s.provider : DEFAULTS.provider;
  profiles[selectedProvider] = { apiKey: s.apiKey, model: s.model, endpoint: s.endpoint };
  $('provider').value = selectedProvider;
  $('presentationMode').checked = !!s.presentationMode;
  showProfile(selectedProvider);
}
async function saveSettings() {
  profiles[selectedProvider] = currentProfile();
  await chrome.storage.local.set({ provider: selectedProvider, ...profiles[selectedProvider], providerProfiles: profiles, presentationMode: $('presentationMode').checked });
}
async function run(task) {
  if (busy) return;
  busy = true;
  for (const el of document.querySelectorAll('button, input, select')) el.disabled = true;
  try { await task(); }
  catch (error) { $('status').textContent = `Error: ${error.message || 'Operation failed. Reload the extension and try again.'}`; }
  finally {
    busy = false;
    for (const el of document.querySelectorAll('button, input, select')) el.disabled = false;
    toggleProviderFields();
  }
}
$('provider').addEventListener('change', () => {
  profiles[selectedProvider] = currentProfile();
  selectedProvider = $('provider').value;
  showProfile(selectedProvider);
  $('status').textContent = 'Enter this provider’s settings, then save.';
});
$('presentationMode').addEventListener('change', () => run(async () => {
  await chrome.storage.local.set({ presentationMode: $('presentationMode').checked });
  $('status').textContent = $('presentationMode').checked ? 'Presentation Mode ON. Page actions are disabled.' : 'Presentation Mode OFF. Page actions are enabled.';
}));
$('save').onclick = () => run(async () => { await saveSettings(); $('status').textContent = 'Saved.'; });
$('test').onclick = () => run(async () => {
  $('status').textContent = 'Testing current settings…';
  await saveSettings();
  const r = await chrome.runtime.sendMessage({ action: 'testAI' });
  $('status').textContent = r?.ok ? `Connected: ${r.answer}` : `Error: ${r?.error || 'No response. Reload the extension.'}`;
});
$('refreshModels').onclick = () => run(async () => {
  $('status').textContent = 'Loading available Gemini models…';
  await saveSettings();
  const r = await chrome.runtime.sendMessage({ action: 'listGeminiModels' });
  if (!r?.ok) throw new Error(r?.error || 'Model discovery failed.');
  $('modelList').replaceChildren();
  for (const model of r.models) {
    const o = document.createElement('option'); o.value = model; $('modelList').append(o);
  }
  $('status').textContent = `Found ${r.models.length} models. Leave Model blank for automatic selection.`;
});
$('open').onclick = () => run(async () => {
  await saveSettings();
  const r = await chrome.runtime.sendMessage({ action: 'openFromPopup' });
  if (!r?.ok) throw new Error(r?.error || 'Could not open the assistant.');
  window.close();
});
run(load);
