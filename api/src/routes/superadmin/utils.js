const toIso = (v) => {
  if (!v) return '';
  try {
    const d = v instanceof Date ? v : new Date(v);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString();
  } catch {
    return '';
  }
};

module.exports = { toIso };
