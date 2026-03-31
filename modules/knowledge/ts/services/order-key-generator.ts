const ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = ALPHABET.length;
const MID_CHAR = ALPHABET[Math.floor(BASE / 2)] as string;

function charToIndex(c: string): number {
  const idx = ALPHABET.indexOf(c);
  return idx === -1 ? 0 : idx;
}

function indexToChar(i: number): string {
  const clamped = Math.max(0, Math.min(BASE - 1, i));
  return ALPHABET[clamped] as string;
}

function toBase62(num: number, length: number): string {
  let result = "";
  let n = num;
  for (let i = 0; i < length; i++) {
    result = indexToChar(n % BASE) + result;
    n = Math.floor(n / BASE);
  }
  return result;
}

export function firstOrderKey(): string {
  return MID_CHAR;
}

export function orderKeyBefore(key: string): string {
  if (!key || key.length === 0) return MID_CHAR;

  const firstChar = key[0] as string;
  const idx = charToIndex(firstChar);

  if (idx > 0) {
    const midIdx = Math.floor(idx / 2);
    return indexToChar(midIdx);
  }

  // Prepend smallest char and find mid
  return (ALPHABET[0] as string) + MID_CHAR;
}

export function orderKeyAfter(key: string): string {
  if (!key || key.length === 0) return MID_CHAR;

  const lastChar = key[key.length - 1] as string;
  const idx = charToIndex(lastChar);

  if (idx < BASE - 1) {
    const midIdx = Math.floor((idx + BASE) / 2);
    return key.slice(0, -1) + indexToChar(midIdx);
  }

  // Append mid char
  return key + MID_CHAR;
}

export function orderKeyBetween(
  before: string | null,
  after: string | null,
): string | null {
  if (!before && !after) return MID_CHAR;
  if (!before) return orderKeyBefore(after!);
  if (!after) return orderKeyAfter(before);

  if (before >= after) return null;

  let result = "";
  const maxLen = Math.max(before.length, after.length) + 1;

  for (let i = 0; i < maxLen; i++) {
    const charBefore = i < before.length ? charToIndex(before[i] as string) : 0;
    const charAfter =
      i < after.length ? charToIndex(after[i] as string) : BASE - 1;

    if (charBefore === charAfter) {
      result += indexToChar(charBefore);
      continue;
    }

    const mid = Math.floor((charBefore + charAfter) / 2);
    if (mid > charBefore) {
      // Found a midpoint character
      result += indexToChar(mid);
      // Ensure strictly between
      if (result > before && result < after) {
        return result;
      }
    } else {
        // Fallback to append logic if mid == charBefore
         result += indexToChar(charBefore);
    }
  }

  // If we reached here, just append MID_CHAR to make it larger than 'before'
  return before + MID_CHAR;
}

export function rebalanceOrderKeys(count: number): string[] {
  if (count <= 0) return [];
  
  // Calculate required length to fit 'count' items with gap
  // We want gap >= 1. Total space needed ~ count * 2 at least?
  // Let's use simple logic: find L such that BASE^L > count + 1
  
  let length = 1;
  while (Math.pow(BASE, length) <= count + 1) {
    length++;
  }

  const keys: string[] = [];
  const totalSpace = Math.pow(BASE, length);
  const step = Math.floor(totalSpace / (count + 1));

  for (let i = 1; i <= count; i++) {
    const val = i * step;
    keys.push(toBase62(val, length));
  }

  return keys;
}

export function needsRebalancing(before: string, after: string): boolean {
  // If keys are becoming too long (e.g. > 20 chars), rebalance
  if (before.length > 20 || after.length > 20) return true;
  
  // Or if we can't find a midpoint (orderKeyBetween returns null or same)
  // Our new orderKeyBetween shouldn't fail easily, but checks are good
  const result = orderKeyBetween(before, after);
  return result === null || result === before || result === after;
}