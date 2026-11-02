export const defaultLogger = {
  info(message, meta = {}) { console.log('[dwtc]', message, safeMeta(meta)); },
  warn(message, meta = {}) { console.warn('[dwtc]', message, safeMeta(meta)); },
  error(message, meta = {}) { console.error('[dwtc]', message, safeMeta(meta)); }
};
function safeMeta(meta) {
  const out = {};
  for (const [key, value] of Object.entries(meta || {})) {
    if (/url|secret|token|password|cookie/i.test(key)) out[key] = '[redacted]';
    else if (typeof value === 'string') out[key] = value.slice(0, 300);
    else out[key] = value;
  }
  return out;
}
