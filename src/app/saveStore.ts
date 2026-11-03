// saveStore - keeps the SD save area (game records, saved games) in the browser with IndexedDB
//
// Only the save area is kept (sectors from 16 MB, see devices/SaveArea.ts): the SD image itself is
// still lost on reload unless downloaded (decision of 2026-10-27). The area lives in its own database,
// one record per written sector, so it survives a new default SD with updated games.
// Without IndexedDB (Node tests, blocked storage) every function does nothing and the area lasts
// until the page is closed.

import { SaveArea } from '../devices/SaveArea';

const DB = 'bo6502-sd-saves';
const STORE = 'sectors';

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise(resolve => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** reads the stored sectors into the area and keeps every later write in the database */
export async function attachSaveStore(area: SaveArea): Promise<boolean> {
  const db = await open();
  if (!db) return false;
  await new Promise<void>(resolve => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return resolve();
        const d = c.value;
        if (typeof c.key === 'number' && SaveArea.contains(c.key) && d instanceof Uint8Array && d.length === 512) {
          area.sectors.set(c.key, d);
        }
        c.continue();
      };
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
  area.onWrite = sector => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const st = tx.objectStore(STORE);
      const d = area.sectors.get(sector);
      if (d) st.put(d, sector);
      else st.delete(sector);
    } catch {
      // storage full or blocked: the sector stays in memory only
    }
  };
  return true;
}
