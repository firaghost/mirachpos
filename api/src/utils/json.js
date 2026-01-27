const safeJsonParse = (raw, fallback) => {
  try {
    if (raw == null) return fallback;
    if (typeof raw === 'object') return raw;
    const parsed = JSON.parse(String(raw));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

const safeJsonStringify = (value) => {
  try {
    if (value == null) return null;
    return JSON.stringify(value);
  } catch {
    return null;
  }
};

module.exports = { safeJsonParse, safeJsonStringify };
