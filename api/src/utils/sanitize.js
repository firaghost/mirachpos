const sanitizeText = (value, { lower = false, maxLen = 200 } = {}) => {
  if (value == null) return '';
  let s = String(value).replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (lower) s = s.toLowerCase();
  if (Number.isFinite(maxLen) && maxLen > 0) s = s.slice(0, maxLen);
  return s;
};

const sanitizeLikeInput = (value, options) => {
  const s = sanitizeText(value, options);
  return s ? s.replace(/[%_]/g, '') : '';
};

module.exports = {
  sanitizeText,
  sanitizeLikeInput,
};
