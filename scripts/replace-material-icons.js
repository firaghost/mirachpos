import fs from 'node:fs';
import path from 'node:path';

const root = 'd:/Projects/mirachpos';
const exts = new Set(['.tsx', '.ts', '.jsx', '.js']);
const skipDirs = new Set(['node_modules', '.git', 'dist', 'api']);
const importLine = "import { AppIcon } from '@/components/ui/app-icon';\n";

const removeMaterial = (s) => s.split(/\s+/).filter(Boolean).filter((t) => t !== 'material-symbols-outlined').join(' ');

const textSizeMap = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  '2xl': 24,
  '3xl': 30,
  '4xl': 36,
  '5xl': 48,
  '6xl': 60,
};

const inferSizeProp = (raw) => {
  const pxMatch = raw.match(/text-\[(\d+)px\]/);
  if (pxMatch) return Number(pxMatch[1]);

  const tokenMatch = raw.match(/\btext-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl)\b/);
  if (tokenMatch) return textSizeMap[tokenMatch[1]] || null;

  return null;
};

const buildClassProp = (raw, wrap) => {
  const cleaned = removeMaterial(raw);
  if (!cleaned) return '';
  return wrap === 'template' ? ` className={\`${cleaned}\`}` : ` className=\"${cleaned}\"`;
};

const buildSizeProp = (raw) => {
  const size = inferSizeProp(raw);
  return size ? ` size={${size}}` : '';
};

const replaceSpan = (text) => {
  let changed = false;
  const patterns = [
    {
      re: new RegExp('<span\\s+className="([^"]*material-symbols-outlined[^"]*)"[^>]*>([^<{]+)<\\/span>', 'g'),
      wrap: 'string',
      expr: false,
    },
    {
      re: new RegExp('<span\\s+className=\\{`([^`]*material-symbols-outlined[^`]*)`\\}[^>]*>([^<{]+)<\\/span>', 'g'),
      wrap: 'template',
      expr: false,
    },
    {
      re: new RegExp('<span\\s+className=\\{[\'\"]([^\'\"]*material-symbols-outlined[^\'\"]*)[\'\"]\\}[^>]*>([^<{]+)<\\/span>', 'g'),
      wrap: 'string',
      expr: false,
    },
    {
      re: new RegExp('<span\\s+className="([^"]*material-symbols-outlined[^"]*)"[^>]*>\\{([^}]+)\\}<\\/span>', 'g'),
      wrap: 'string',
      expr: true,
    },
    {
      re: new RegExp('<span\\s+className=\\{`([^`]*material-symbols-outlined[^`]*)`\\}[^>]*>\\{([^}]+)\\}<\\/span>', 'g'),
      wrap: 'template',
      expr: true,
    },
    {
      re: new RegExp('<span\\s+className=\\{[\'\"]([^\'\"]*material-symbols-outlined[^\'\"]*)[\'\"]\\}[^>]*>\\{([^}]+)\\}<\\/span>', 'g'),
      wrap: 'string',
      expr: true,
    },
  ];

  for (const { re, wrap, expr } of patterns) {
    text = text.replace(re, (match, cls, icon) => {
      changed = true;
      const classProp = buildClassProp(cls, wrap);
      const sizeProp = buildSizeProp(cls);
      const iconValue = expr ? `{${icon.trim()}}` : `\"${icon.trim()}\"`;
      return `<AppIcon name=${iconValue}${classProp}${sizeProp} />`;
    });
  }

  return { text, changed };
};

const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(entry.name)) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(p);
      continue;
    }

    if (!exts.has(path.extname(entry.name))) continue;

    const text = fs.readFileSync(p, 'utf8');
    const res = replaceSpan(text);
    if (!res.changed) continue;

    let next = res.text;
    if (!next.includes('app-icon')) {
      const match = next.match(/^(import[\s\S]*?;\s*)+/);
      if (match) next = next.replace(match[0], match[0] + importLine);
      else next = importLine + next;
    }

    fs.writeFileSync(p, next, 'utf8');
  }
};

walk(root);
console.log('Done replacing material icons.');
