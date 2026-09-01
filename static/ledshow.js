/**
 * ledshow.js — LedShow BLE Protocol Library
 *
 * Standalone library that owns all direct communication with a LedShow
 * LED badge (12x48 grid) over Web Bluetooth. It knows nothing about the
 * UI — drawing, text rendering, tab switching, etc. all live in the app
 * that uses this file.
 *
 * PACKET FORMAT (confirmed from a real BLE HCI snoop capture, see PROTOCOL.md):
 *
 *   [group: 2 bytes] [id: 2 bytes] [len: 2 bytes, big-endian] [payload: len bytes] [CRC16/MODBUS: 2 bytes, big-endian]
 *
 * There is no fixed packet size and no zero-padding — every packet is
 * exactly 6 + len bytes, and the last 2 bytes are a CRC-16/MODBUS checksum
 * (poly 0x8005 reflected / 0xA001, init 0xFFFF) computed over everything
 * before it. This one packet builder (`_packet`) replaces what used to be
 * a set of hand-captured hex strings padded to 16 bytes — including the
 * old per-animation "hash" table, which turned out to just be this same
 * CRC computed over each animation's command bytes, not real lookup data.
 *
 * To add a newly reverse-engineered command, don't touch the connection,
 * queueing, or CRC internals — just add a one-line wrapper that calls
 * this.send(cmdGrp, cmdId, payloadBytes), e.g.:
 *
 *   async someNewFeature(v) {
 *     await this.send(0xAA, 0xBB, [v]);
 *   }
 *
 * Loaded as a plain classic script (no ES module syntax) so it works
 * with a simple <script src="ledshow.js"></script>, with no bundler
 * or module server required.
 */
class LedShow {
  static ROWS = 12; static COLS = 48;

  // Confirmed single-byte effect selector (previously mis-documented as a
  // 3-byte "code" — the other 2 bytes were always just the CRC of that
  // specific command, not part of the effect identity).
  static EFFECT = { STATIC: 0, LEFT: 1, RIGHT: 2, UP: 3, DOWN: 4, SNOW: 5, SCROLL: 6, LASER: 7 };

  static UUID = {
    SERVICE:  LedShow._uuid(0xA950),
    SERVICE2: LedShow._uuid(0xAE00), // device splits characteristics across two services
    NAME:     LedShow._uuid(0x2A00),
    CMD:      LedShow._uuid(0xA951),
    BUFFER:   LedShow._uuid(0xA952),
    NOTIFY:   LedShow._uuid(0xA953),
  };

  constructor() { this._device = null; this._charCmd = null; this._charBuf = null; this._charName = null; this._writeQueue = Promise.resolve(); }

  // Serializes all BLE writes so rapid calls (e.g. live drawing) never overlap.
  _enqueue(taskFn) {
    const result = this._writeQueue.then(taskFn, taskFn);
    this._writeQueue = result.then(() => {}, () => {});
    return result;
  }
  get connected() { return !!(this._device?.gatt.connected); }

  static _uuid(id) { return `0000${id.toString(16).padStart(4,'0')}-0000-1000-8000-00805f9b34fb`; }
  static _sleep(ms) { return new Promise(r=>setTimeout(r,ms)); }
  static _range(v,a,b,n) { if (v<a||v>b) throw new RangeError(`${n} must be ${a}-${b}, got ${v}`); }
  _assertCmd() { if (!this._charCmd) throw new Error('Not connected'); }

  // CRC-16/MODBUS: poly 0x8005 reflected (0xA001), init 0xFFFF, no xorout.
  // Confirmed byte-for-byte against a real capture across every command
  // type this library sends (see PROTOCOL.md).
  static _crc16modbus(bytes) {
    let crc = 0xFFFF;
    for (const b of bytes) {
      crc ^= b;
      for (let i = 0; i < 8; i++) {
        crc = (crc & 1) ? ((crc >>> 1) ^ 0xA001) : (crc >>> 1);
      }
    }
    return crc & 0xFFFF;
  }

  // Builds a full packet: opcode(2) + len(2, big-endian) + payload + crc(2, big-endian).
  static _packet(cmdGrp, cmdId, payloadBytes) {
    const payload = Array.from(payloadBytes);
    const body = [cmdGrp, cmdId, (payload.length >> 8) & 0xff, payload.length & 0xff, ...payload];
    const crc = LedShow._crc16modbus(body);
    body.push((crc >> 8) & 0xff, crc & 0xff);
    return new Uint8Array(body);
  }

  async connect(onDisconnect) {
    if (!navigator.bluetooth) throw new Error('Web Bluetooth not supported in this browser');
    this._device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [LedShow.UUID.SERVICE, LedShow.UUID.SERVICE2, LedShow.UUID.NAME, LedShow.UUID.CMD, LedShow.UUID.BUFFER, LedShow.UUID.NOTIFY]
    });
    const server = await this._device.gatt.connect();

    // Gather characteristics across every reachable primary service —
    // the badge splits them between 0xA950 and 0xAE00.
    let services;
    try { services = await server.getPrimaryServices(); }
    catch { services = []; }
    if (!services.length) {
      try { services = [await server.getPrimaryService(LedShow.UUID.SERVICE)]; } catch {}
    }
    if (!services.length) throw new Error('No GATT services found');

    const allChars = [];
    for (const svc of services) {
      try { allChars.push(...(await svc.getCharacteristics())); } catch {}
    }
    const find = (uuid) => allChars.find(c => c.uuid === uuid) || null;
    this._charCmd  = find(LedShow.UUID.CMD);
    this._charBuf  = find(LedShow.UUID.BUFFER);
    this._charName = find(LedShow.UUID.NAME);
    if (!this._charCmd) throw new Error('Command characteristic (0xA951) not found on this device — check the service UUIDs match what your scanner reported');
    if (onDisconnect) this._device.addEventListener('gattserverdisconnected', onDisconnect);
    let name = this._device.name;
    if (this._charName) { try { name = new TextDecoder().decode(await this._charName.readValue()); } catch {} }
    return name || 'LedShow';
  }

  async disconnect() {
    if (this._device?.gatt.connected) this._device.gatt.disconnect();
    this._charCmd = this._charBuf = this._charName = null; this._device = null;
  }

  // ── Generic command builders — reuse these for anything newly
  // reverse-engineered. Both compute the CRC automatically.
  //   await led.send(0xAA, 0xBB, [1, 2, 3]);      // writes to CMD (0xA951)
  //   await led.sendBuf(0xAA, 0xBB, [1, 2, 3]);   // writes to BUFFER (0xA952)
  async send(cmdGrp, cmdId, payloadBytes = []) {
    this._assertCmd();
    const packet = LedShow._packet(cmdGrp, cmdId, payloadBytes);
    console.log("send:", "(", packet.length, ")", Array.from(packet).map(b => b.toString(16).padStart(2, '0')).join('').toLowerCase());
    return this._enqueue(() => this._charCmd.writeValueWithoutResponse(packet));
  }
  async sendBuf(cmdGrp, cmdId, payloadBytes = []) {
    if (!this._charBuf) throw new Error('Buffer characteristic (0xA952) unavailable');
    const packet = LedShow._packet(cmdGrp, cmdId, payloadBytes);
    console.log("sendBuf:", "(", packet.length, ")", Array.from(packet).map(b => b.toString(16).padStart(2, '0')).join('').toLowerCase());
    return this._enqueue(() => this._charBuf.writeValueWithoutResponse(packet));
  } 

  async freeMode() { await this.send(0x03, 0x01, [0x01]); }

  async drawPixel(row, col, on = true) {
    LedShow._range(row, 0, 11, 'row'); LedShow._range(col, 0, 47, 'col');
    const m = on ? 0x00 : 0x04;
    const q = Math.floor(col / 16) % 3;
    const cy = col % 16;
    await this.send(0x03, 0x02, [m, row, (q << 4) | cy]);
  }

  async drawFrame(frame) {
    for (let r = 0; r < LedShow.ROWS; r++)
      for (let c = 0; c < LedShow.COLS; c++)
        await this.drawPixel(r, c, !!(frame[r]?.[c]));
  }

  async clearFrame() {
    await this.send(0x03, 0x01, [0x01]);
  }

  async animate(index) {
    LedShow._range(index, 0, 18, 'animation index');
    await this.send(0x05, 0x03, [index, 0x00, 0x00, 0x64]);
  }

  async setBrightness(v) { LedShow._range(v, 0, 255, 'brightness'); await this.send(0x00, 0x01, [v]); }
  async setSpeed(v)      { LedShow._range(v, 0, 255, 'speed');      await this.send(0x00, 0x02, [v]); }
  async setEffect(effect) { LedShow._range(effect, 0, 7, 'effect'); await this.send(0x00, 0x04, [effect]); }

  // Activates a previously-uploaded program/slot (e.g. after a bitmap
  // upload). Only ever observed with id=1 in captures.
  async setActiveProgram(id = 1) { await this.send(0x01, 0x02, [id]); }

  // Confirmed (opcode 0x06 0x01, payload = single 0x01/0x00 byte): a
  // general "enter/exit special session" toggle, shared by BOTH the
  // spectrogram stream AND the bitmap-upload flow — not spectrogram-only,
  // despite the earlier name. Call sessionStart() before streaming
  // spectrogram frames or before an upload sequence, sessionStop() after.
  async sessionStart() { await this.send(0x06, 0x01, [0x01]); }
  async sessionStop()  { await this.send(0x06, 0x01, [0x00]); }
  // Kept as an alias — spectrogram mode entry is just a session start.
  async spectrogramMode() { await this.sessionStart(); }

  // Confirmed: payload = [MODE, 12 bar-height bytes]. MODE 0 = bottom-up
  // bars, 1 = center-symmetric bars — the device renders this layout
  // itself; pass whichever the UI has selected so the physical badge
  // matches the on-screen preview. Bar values 0-8 (matches the display's
  // usable row range); the true max hasn't been independently confirmed
  // beyond that assumption.
  async spectrogramFrame(bars, mode = 0) {
    if (!Array.isArray(bars) || bars.length !== 12) throw new TypeError('bars must have exactly 12 values (0-8)');
    LedShow._range(mode, 0, 1, 'mode');
    await this.send(0x06, 0x02, [mode, ...bars]);
  }
}