// Synthetic state only. Old, unscoped fixtures remain untouched and unread.
function createPreviewStore(storage, search) {
  const params = new URLSearchParams(search);
  const scenario = params.has('fail-save') ? 'save-error' : 'normal';
  const reviewCase = params.get('case') || '';
  if (reviewCase && !/^[a-z0-9-]{1,40}$/.test(reviewCase)) throw Error('Invalid synthetic review case');
  const prefix = 'onboarding-preview-v2:' + scenario + ':' + (reviewCase ? reviewCase + ':' : '');
  return {
    read(key, fallback) { return JSON.parse(storage.getItem(prefix + key) || 'null') ?? fallback; },
    write(key, value) { storage.setItem(prefix + key, JSON.stringify(value)); return value; }
  };
}
module.exports = { createPreviewStore };
