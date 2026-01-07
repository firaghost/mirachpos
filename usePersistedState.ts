import { useEffect, useState } from 'react';

type Options<T> = {
  validate?: (value: unknown) => value is T;
  serialize?: (value: T) => string;
  deserialize?: (raw: string) => unknown;
  removeWhen?: (value: T) => boolean;
};

export const usePersistedState = <T,>(key: string, fallback: T, options?: Options<T>) => {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      const parsed = options?.deserialize ? options.deserialize(raw) : (JSON.parse(raw) as unknown);
      if (options?.validate) return options.validate(parsed) ? parsed : fallback;
      return (parsed as T) ?? fallback;
    } catch {
      return fallback;
    }
  });

  useEffect(() => {
    try {
      if (options?.removeWhen?.(value)) {
        localStorage.removeItem(key);
        return;
      }
      const raw = options?.serialize ? options.serialize(value) : JSON.stringify(value);
      localStorage.setItem(key, raw);
    } catch {
      // ignore
    }
  }, [key, options, value]);

  return [value, setValue] as const;
};

export const usePersistedString = (key: string, fallback: string, options?: { removeWhen?: (value: string) => boolean }) => {
  return usePersistedState<string>(key, fallback, {
    validate: (v): v is string => typeof v === 'string',
    serialize: (v) => v,
    deserialize: (raw) => raw,
    removeWhen: options?.removeWhen,
  });
};

export const usePersistedNullableString = (
  key: string,
  fallback: string | null,
  options?: { removeWhen?: (value: string | null) => boolean },
) => {
  return usePersistedState<string | null>(key, fallback, {
    validate: (v): v is string | null => typeof v === 'string' || v === null,
    serialize: (v) => (v == null ? '' : v),
    deserialize: (raw) => raw,
    removeWhen: (v) => {
      if (options?.removeWhen) return options.removeWhen(v);
      return v == null;
    },
  });
};
