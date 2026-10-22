// Piccolo helper per creare elementi DOM

type Attrs = Record<string, string | number | boolean | EventListener | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Array<Node | string | null | undefined | false>
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'class') {
      el.className = String(v);
    } else if (v === true) {
      el.setAttribute(k, '');
    } else {
      el.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c);
  }
  return el;
}

export function hex(v: number, digits: number): string {
  return v.toString(16).toUpperCase().padStart(digits, '0');
}

export function parseHex(s: string): number | null {
  const t = s.trim().replace(/^\$|^0x/i, '');
  if (!/^[0-9a-f]{1,4}$/i.test(t)) return null;
  return parseInt(t, 16);
}

/** apre la finestra di scelta file e restituisce il file scelto */
export function pickFile(accept: string, multiple = false): Promise<File[]> {
  return new Promise(resolve => {
    const input = h('input', { type: 'file', accept, multiple });
    input.addEventListener('change', () => resolve([...(input.files ?? [])]));
    input.click();
  });
}

export async function readFile(f: File): Promise<Uint8Array> {
  return new Uint8Array(await f.arrayBuffer());
}

export function download(data: Uint8Array, name: string): void {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: 'application/octet-stream' }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
