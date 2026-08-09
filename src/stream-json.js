/**
 * Incremental extractor for objects inside a streaming JSON array.
 *
 * Why this exists: the suggestion call returns ~5 intents with 3 variants each.
 * Waiting for the whole payload before showing anything wastes the seconds where
 * the first intent is already fully formed. This scans the accumulating text and
 * hands back each intent object the moment its closing brace arrives, so tiles
 * appear one by one instead of all at once at the end.
 *
 * Deliberately not a general JSON parser — it only needs to find the top-level
 * objects inside one named array, and it needs to never throw on a partial buffer.
 */
export class ArrayItemScanner {
  /** @param {string} key name of the array property to scan, e.g. "intents" */
  constructor(key) {
    this.key = key;
    this.buf = '';
    this.arrayStart = -1; // index just past the array's '['
    this.cursor = 0; // where to resume scanning
    this.depth = 0;
    this.objStart = -1;
    this.inString = false;
    this.escaped = false;
    this.done = false;
  }

  /**
   * Feed newly-arrived text.
   * @returns {object[]} items that became complete during this chunk
   */
  push(chunk) {
    if (this.done) return [];
    this.buf += chunk;
    if (this.arrayStart === -1 && !this.#locateArray()) return [];

    const found = [];
    for (let i = this.cursor; i < this.buf.length; i++) {
      const c = this.buf[i];

      if (this.inString) {
        if (this.escaped) this.escaped = false;
        else if (c === '\\') this.escaped = true;
        else if (c === '"') this.inString = false;
        continue;
      }

      if (c === '"') {
        this.inString = true;
      } else if (c === '{') {
        if (this.depth === 0) this.objStart = i;
        this.depth++;
      } else if (c === '}') {
        this.depth--;
        if (this.depth === 0 && this.objStart !== -1) {
          const slice = this.buf.slice(this.objStart, i + 1);
          const parsed = tryParse(slice);
          if (parsed !== undefined) found.push(parsed);
          this.objStart = -1;
        }
      } else if (c === ']' && this.depth === 0) {
        // Array closed. Latch shut so trailing objects elsewhere in the payload
        // are never mistaken for items.
        this.done = true;
        this.cursor = i + 1;
        return found;
      }
    }
    this.cursor = this.buf.length;
    return found;
  }

  #locateArray() {
    const keyIdx = this.buf.indexOf(`"${this.key}"`);
    if (keyIdx === -1) return false;
    const bracket = this.buf.indexOf('[', keyIdx);
    if (bracket === -1) return false;
    this.arrayStart = bracket + 1;
    this.cursor = this.arrayStart;
    return true;
  }
}

function tryParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}
