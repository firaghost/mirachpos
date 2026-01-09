export type DateInput = string | number | Date | null | undefined;

const toDate = (v: DateInput): Date | null => {
  if (!v) return null;
  try {
    const d = v instanceof Date ? v : new Date(v);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  } catch {
    return null;
  }
};

export const formatDeviceDate = (v: DateInput, opts?: Intl.DateTimeFormatOptions) => {
  const d = toDate(v);
  if (!d) return '';
  try {
    return d.toLocaleDateString(undefined, opts);
  } catch {
    return '';
  }
};

export const formatDeviceTime = (v: DateInput, opts?: Intl.DateTimeFormatOptions) => {
  const d = toDate(v);
  if (!d) return '';
  try {
    return d.toLocaleTimeString(undefined, opts);
  } catch {
    return '';
  }
};

export const formatDeviceDateTime = (v: DateInput, opts?: Intl.DateTimeFormatOptions) => {
  const d = toDate(v);
  if (!d) return '';
  try {
    return d.toLocaleString(undefined, opts);
  } catch {
    return '';
  }
};
