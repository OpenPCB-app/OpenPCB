import type { GerberArtifact } from "../../../../sdks/designer/types";

/**
 * Minimal STORE-method ZIP writer.
 *
 * Produces a ZIP archive (PKZip APPNOTE 6.3.4 subset) containing one
 * entry per artifact, with no compression — bytes are stored verbatim.
 * STORE is universally accepted by fab houses and avoids pulling in a
 * compression dependency on the backend. Gerber/CSV files compress
 * well, so if upload size becomes a problem this can be swapped for
 * DEFLATE without touching callers.
 *
 * Output is a `Uint8Array` ready to write to disk or stream to HTTP.
 */

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;

interface EntryRecord {
  fileName: Uint8Array;
  crc32: number;
  size: number;
  data: Uint8Array;
  localHeaderOffset: number;
  dosTime: number;
  dosDate: number;
}

export function packZip(artifacts: ReadonlyArray<GerberArtifact>): Uint8Array {
  const encoder = new TextEncoder();
  const entries: EntryRecord[] = [];
  const chunks: Uint8Array[] = [];
  let cursor = 0;
  const { dosTime, dosDate } = encodeDosDateTime(new Date());

  for (const artifact of artifacts) {
    const nameBytes = encoder.encode(artifact.fileName);
    const dataBytes = encoder.encode(artifact.text);
    const crc = crc32(dataBytes);
    const localHeader = buildLocalHeader(
      nameBytes,
      crc,
      dataBytes.length,
      dosTime,
      dosDate,
    );
    entries.push({
      fileName: nameBytes,
      crc32: crc,
      size: dataBytes.length,
      data: dataBytes,
      localHeaderOffset: cursor,
      dosTime,
      dosDate,
    });
    chunks.push(localHeader, dataBytes);
    cursor += localHeader.length + dataBytes.length;
  }

  const centralStart = cursor;
  for (const e of entries) {
    const central = buildCentralRecord(e);
    chunks.push(central);
    cursor += central.length;
  }
  const centralSize = cursor - centralStart;
  chunks.push(buildEndOfCentral(entries.length, centralSize, centralStart));

  return concat(chunks);
}

function buildLocalHeader(
  name: Uint8Array,
  crc: number,
  size: number,
  dosTime: number,
  dosDate: number,
): Uint8Array {
  const buf = new Uint8Array(30 + name.length);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, SIG_LOCAL, true);
  dv.setUint16(4, 20, true); // version needed
  dv.setUint16(6, 0, true); // general purpose
  dv.setUint16(8, 0, true); // method = STORE
  dv.setUint16(10, dosTime, true);
  dv.setUint16(12, dosDate, true);
  dv.setUint32(14, crc, true);
  dv.setUint32(18, size, true); // compressed size (== size for STORE)
  dv.setUint32(22, size, true); // uncompressed size
  dv.setUint16(26, name.length, true);
  dv.setUint16(28, 0, true); // extra field length
  buf.set(name, 30);
  return buf;
}

function buildCentralRecord(e: EntryRecord): Uint8Array {
  const buf = new Uint8Array(46 + e.fileName.length);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, SIG_CENTRAL, true);
  dv.setUint16(4, 20, true); // version made by
  dv.setUint16(6, 20, true); // version needed
  dv.setUint16(8, 0, true); // general purpose
  dv.setUint16(10, 0, true); // method = STORE
  dv.setUint16(12, e.dosTime, true);
  dv.setUint16(14, e.dosDate, true);
  dv.setUint32(16, e.crc32, true);
  dv.setUint32(20, e.size, true);
  dv.setUint32(24, e.size, true);
  dv.setUint16(28, e.fileName.length, true);
  dv.setUint16(30, 0, true); // extra
  dv.setUint16(32, 0, true); // comment
  dv.setUint16(34, 0, true); // disk number
  dv.setUint16(36, 0, true); // internal attrs
  dv.setUint32(38, 0, true); // external attrs
  dv.setUint32(42, e.localHeaderOffset, true);
  buf.set(e.fileName, 46);
  return buf;
}

function buildEndOfCentral(
  entryCount: number,
  centralSize: number,
  centralOffset: number,
): Uint8Array {
  const buf = new Uint8Array(22);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, SIG_END, true);
  dv.setUint16(4, 0, true); // disk number
  dv.setUint16(6, 0, true); // start disk
  dv.setUint16(8, entryCount, true);
  dv.setUint16(10, entryCount, true);
  dv.setUint32(12, centralSize, true);
  dv.setUint32(16, centralOffset, true);
  dv.setUint16(20, 0, true); // comment length
  return buf;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const c of chunks) {
    out.set(c, cursor);
    cursor += c.length;
  }
  return out;
}

function encodeDosDateTime(d: Date): { dosTime: number; dosDate: number } {
  const dosTime =
    (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const dosDate =
    ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { dosTime, dosDate };
}

// =========================================================================
// CRC-32 (IEEE 802.3 polynomial, reversed)
// =========================================================================

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    const idx = (crc ^ bytes[i]!) & 0xff;
    crc = (crc >>> 8) ^ CRC_TABLE[idx]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
