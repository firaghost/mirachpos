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
    
    let didPrint = false;
    const tryPrint = () => {
      if (didPrint) return;
      didPrint = true;
      try {
        w.focus();
        w.print();
      } catch {
        // ignore
      }
    };

    w.document.open();
    w.document.write(html);
    w.document.close();

    // Try multiple triggers to ensure print happens
    try {
      w.addEventListener('load', tryPrint);
    } catch {
      // ignore
    }
    try {
      w.addEventListener('DOMContentLoaded', tryPrint);
    } catch {
      // ignore
    }
    const t1 = w.setTimeout(tryPrint, 250);
    const t2 = w.setTimeout(tryPrint, 1000);

    w.addEventListener('beforeunload', () => {
      try {
        w.clearTimeout(t1);
        w.clearTimeout(t2);
      } catch {
        // ignore
      }
    });
    return true;
  } catch {
    return false;
  }
};
