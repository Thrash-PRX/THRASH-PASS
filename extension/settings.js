/* Shared defaults for the popup and background worker. */
globalThis.TP_SETTINGS = {
  defaults: { provider: 'gemini', model: '', endpoint: '', apiKey: '', presentationMode: false },
  providers: {
    gemini: { model: '', endpoint: '' },
    openai: { model: 'gpt-4o-mini', endpoint: 'https://api.openai.com/v1/chat/completions' },
    kimi: { model: 'moonshot-v1-8k', endpoint: 'https://api.moonshot.cn/v1/chat/completions' },
    custom: { model: '', endpoint: '' }
  }
};
