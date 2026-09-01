/**
 * ledshow.js — LedShow BLE Protocol Library
 *
 * Standalone library that owns all direct communication with a LedShow
 * LED badge (12x48 grid) over Web Bluetooth. It knows nothing about the
 * UI — drawing, text rendering, tab switching, etc. all live in the app
 * that uses this file.
 *
 * To add a newly reverse-engineered command, don't touch the connection
 * or write-queue internals — just add a one-line wrapper that calls
 * this.send(hex) or this.sendBuf(hex), e.g.:
 *
 *   async someNewFeature(v) {
 *     await this.send(`AABBCCDD${v.toString(16).padStart(2,'0')}...`);
 *   }
 *
 * Loaded as a plain classic script (no ES module syntax) so it works
 * with a simple <script src="ledshow.js"></script>, with no bundler
 * or module server required.
 */
class LedShow {
  static ROWS = 12; static COLS = 48;
  static ANIM_HASHES = ["1f38","e339","a739","5b38","2f39","d338","9738","6b39","7f3a","833b","c73b","3b3a","4f3b","b33a","f73a","0b3b","df3c","233d","673d"];
  static EFFECT = { STATIC:"00a024", LEFT:"0160e5", RIGHT:"0261a5", UP:"03a164", DOWN:"046325", SNOW:"05a3e4", SCROLL:"06a2a4", LASER:"076265" };
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
  static _rnd5() { return Math.floor(Math.random()*16**5).toString(16).padStart(5,'0'); }
  static _sleep(ms) { return new Promise(r=>setTimeout(r,ms)); }
  static _hex(hex) { return new Uint8Array(hex.match(/.{2}/g).map(b=>parseInt(b,16))); }
  static _range(v,a,b,n) { if (v<a||v>b) throw new RangeError(`${n} must be ${a}-${b}, got ${v}`); }
  _assertCmd() { if (!this._charCmd) throw new Error('Not connected'); }

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

  // ── Generic raw command — this is the one thing to reuse when you
  // reverse-engineer a new command from a BLE sniff. Just add a one-line
  // wrapper below, e.g.:
  //   async someNewFeature(v) { await this.send(`AABBCCDD${v.toString(16).padStart(2,'0')}...`); }
  async send(hex)    { this._assertCmd(); return this._enqueue(() => this._charCmd.writeValueWithoutResponse(LedShow._hex(hex))); }
  async sendBuf(hex)  { if (!this._charBuf) throw new Error('Buffer characteristic (0xA952) unavailable'); return this._enqueue(() => this._charBuf.writeValueWithoutResponse(LedShow._hex(hex))); }

  async freeMode() { await this.send('0301000101aca1000000000000000000'); }

  async drawPixel(row, col, on = true) {
    LedShow._range(row, 0, 11, 'row'); LedShow._range(col, 0, 47, 'col');
    const m = on ? '00' : '04';
    const q = Math.floor(col/16) % 3;
    const cy = col % 16;
    await this.send(`03020003${m}0${row.toString(16)}${q.toString(16)}${cy.toString(16).padStart(1,'0')}${LedShow._rnd5()}0000000000000`);
  }

  async drawFrame(frame) {
    for (let r = 0; r < LedShow.ROWS; r++)
      for (let c = 0; c < LedShow.COLS; c++)
        await this.drawPixel(r, c, !!(frame[r]?.[c]));
  }

  async animate(index) {
    LedShow._range(index, 0, 18, 'animation index');
    await this.send(`05030004${index.toString(16).padStart(2,'0')}016464${LedShow.ANIM_HASHES[index]}000000000000`);
  }

  async setBrightness(v) { LedShow._range(v,0,255,'brightness'); await this.sendBuf(`00010001${v.toString(16).padStart(2,'0')}6c24000000000000000000`); }
  async setSpeed(v)      { LedShow._range(v,0,255,'speed');      await this.sendBuf(`00020001${v.toString(16).padStart(2,'0')}2824000000000000000000`); }
  async setEffect(effect) { await this.send(`00040001${effect}000000000000000000`); }

  async spectrogramMode() { await this.send('06010001' + '01' + 'ac6d' + '000000000000000000'); }
  async spectrogramFrame(bars, side) {
    if (!Array.isArray(bars) || bars.length !== 10) throw new TypeError('bars must have exactly 10 values (0-8)');
    const s = (side !== undefined ? side : Math.floor(Math.random()*10)).toString(16).padStart(2,'0');
    await this.send('0602000c' + '01' + '0' + s.slice(-1) + bars.map(v => `0${v.toString(16)}`).join(''));
  }
}