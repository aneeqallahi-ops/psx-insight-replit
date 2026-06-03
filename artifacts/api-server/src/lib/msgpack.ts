// Minimal, dependency-free MessagePack decoder (decode-only).
//
// psxterminal.com's WebSocket (wss://psxterminal.com/rt) sends frames encoded
// as MessagePack. We only ever READ frames (subscribe messages are sent as
// plain JSON text, which the server accepts), so a decoder is all we need.
//
// Supports the subset MessagePack actually uses on the wire: nil, bool, ints
// (fix/8/16/32/64), floats (32/64), str (fix/8/16/32), bin (8/16/32),
// arrays (fix/16/32) and maps (fix/16/32). Extensions are not used by this
// API; if one ever appears we throw so it surfaces in logs rather than
// silently corrupting data.

class Reader {
  private view: DataView;
  private pos = 0;
  private decoder = new TextDecoder();

  constructor(private bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  hasMore(): boolean {
    return this.pos < this.bytes.length;
  }

  private u8(): number {
    return this.view.getUint8(this.pos++);
  }

  private str(len: number): string {
    const s = this.decoder.decode(this.bytes.subarray(this.pos, this.pos + len));
    this.pos += len;
    return s;
  }

  private bin(len: number): Uint8Array {
    const b = this.bytes.subarray(this.pos, this.pos + len);
    this.pos += len;
    return b;
  }

  read(): unknown {
    const b = this.u8();

    // positive fixint
    if (b <= 0x7f) return b;
    // negative fixint
    if (b >= 0xe0) return b - 0x100;
    // fixstr
    if (b >= 0xa0 && b <= 0xbf) return this.str(b & 0x1f);
    // fixarray
    if (b >= 0x90 && b <= 0x9f) return this.readArray(b & 0x0f);
    // fixmap
    if (b >= 0x80 && b <= 0x8f) return this.readMap(b & 0x0f);

    switch (b) {
      case 0xc0: return null;
      case 0xc2: return false;
      case 0xc3: return true;

      case 0xcc: { const v = this.view.getUint8(this.pos); this.pos += 1; return v; }
      case 0xcd: { const v = this.view.getUint16(this.pos); this.pos += 2; return v; }
      case 0xce: { const v = this.view.getUint32(this.pos); this.pos += 4; return v; }
      case 0xcf: { const v = this.view.getBigUint64(this.pos); this.pos += 8; return Number(v); }

      case 0xd0: { const v = this.view.getInt8(this.pos); this.pos += 1; return v; }
      case 0xd1: { const v = this.view.getInt16(this.pos); this.pos += 2; return v; }
      case 0xd2: { const v = this.view.getInt32(this.pos); this.pos += 4; return v; }
      case 0xd3: { const v = this.view.getBigInt64(this.pos); this.pos += 8; return Number(v); }

      case 0xca: { const v = this.view.getFloat32(this.pos); this.pos += 4; return v; }
      case 0xcb: { const v = this.view.getFloat64(this.pos); this.pos += 8; return v; }

      case 0xd9: { const len = this.view.getUint8(this.pos); this.pos += 1; return this.str(len); }
      case 0xda: { const len = this.view.getUint16(this.pos); this.pos += 2; return this.str(len); }
      case 0xdb: { const len = this.view.getUint32(this.pos); this.pos += 4; return this.str(len); }

      case 0xc4: { const len = this.view.getUint8(this.pos); this.pos += 1; return this.bin(len); }
      case 0xc5: { const len = this.view.getUint16(this.pos); this.pos += 2; return this.bin(len); }
      case 0xc6: { const len = this.view.getUint32(this.pos); this.pos += 4; return this.bin(len); }

      case 0xdc: { const len = this.view.getUint16(this.pos); this.pos += 2; return this.readArray(len); }
      case 0xdd: { const len = this.view.getUint32(this.pos); this.pos += 4; return this.readArray(len); }

      case 0xde: { const len = this.view.getUint16(this.pos); this.pos += 2; return this.readMap(len); }
      case 0xdf: { const len = this.view.getUint32(this.pos); this.pos += 4; return this.readMap(len); }

      default:
        throw new Error(`msgpack: unsupported type byte 0x${b.toString(16)}`);
    }
  }

  private readArray(len: number): unknown[] {
    const out: unknown[] = new Array(len);
    for (let i = 0; i < len; i++) out[i] = this.read();
    return out;
  }

  private readMap(len: number): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (let i = 0; i < len; i++) {
      const key = this.read();
      out[String(key)] = this.read();
    }
    return out;
  }
}

/** Decode a single MessagePack value from the given bytes. */
export function decodeMsgpack(bytes: Uint8Array): unknown {
  return new Reader(bytes).read();
}
