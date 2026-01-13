export const escapeHtml = (s: string) =>
  String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

export const openPrintWindow = (html: string): boolean => {
  try {
    const w = window.open('', '_blank', 'width=420,height=700');
    if (!w) return false;
    w.document.open();
    w.document.write(html);
    w.document.close();
    const t = w.setTimeout(() => {
      try {
        w.focus();
        w.print();
      } catch {
        // ignore
      }
    }, 250);
    w.addEventListener('beforeunload', () => {
      try {
        w.clearTimeout(t);
      } catch {
        // ignore
      }
    });
    return true;
  } catch {
    return false;
  }
};
