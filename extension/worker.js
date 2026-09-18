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
