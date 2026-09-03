# LedShow BLE Protocol

Reverse-engineered from BLE sniffs of the official LedShow Android app
talking to a 12×48 LED badge (`ledshow-D37F`, MAC `3C:E9:6E:80:D3:7F` in our
captures — other units are expected to use the same protocol with a
different MAC/name).

This document describes what's **confirmed by testing** versus what's
**inferred but unverified**. Where a byte's meaning isn't confirmed, it's
labeled as such rather than guessed silently.

## Transport

- **Bluetooth Low Energy**, standard GATT.
- The device splits its custom characteristics across **two primary
  services** — a scanner/OS pairing dialog may show them as:
  - `0000a950-0000-1000-8000-00805f9b34fb`
  - `0000ae00-0000-1000-8000-00805f9b34fb`
  - `00001800-0000-1000-8000-00805f9b34fb` (standard GAP service, unused by
    this app beyond the device name)

### Characteristics

| UUID | Short name | Properties | Purpose |
|---|---|---|---|
| `0000a951-...` | `CMD` | Write | Main command channel. Almost every command in this doc goes here. |
| `0000a952-...` | `BUFFER` | Write | Secondary write channel, used for brightness/speed and (per the official app) large data uploads like custom-text bitmaps. |
| `0000a953-...` | `NOTIFY` | Notify | Device → host responses. Not currently used by this app; content/format unconfirmed. |
| `0000ae01-...` | — | Write | Present on some units, purpose unconfirmed. Not used by this app. |
| `0000ae02-...` | — | Notify | Present on some units, purpose unconfirmed. Not used by this app. |
| `00002a00-...` | `NAME` | Read/Write | Standard GATT Device Name characteristic. |

**Observed but unused: an auth-looking handshake on `0xAE01`/`0xAE02`.**
One capture shows an exchange on these two characteristics *before* any
`CMD`/`BUFFER` traffic: a write to `0xAE01`, a notify back on `0xAE02`,
then a write containing the literal ASCII bytes `70 61 73 73` (`"pass"`)
prefixed with `02`, echoed back unchanged on the notify. This looks like
some form of challenge/response using a fixed default "password" — typical
of low-cost BLE devices with nominal pairing security. Every command in
this document works over `CMD`/`BUFFER` without ever performing this
handshake, so it doesn't appear to gate normal operation, but it's
recorded here in case some other function (e.g. successfully triggering
the bitmap-upload path) turns out to require it.

**Important:** don't rely on a single "primary service" — some Web
Bluetooth stacks only expose characteristics correctly when you enumerate
*all* primary services on the connected GATT server and search across all
of them for the UUIDs above, rather than assuming they all live under one
service. (This tripped up an earlier version of this app — see the git
history / changelog if working from a fork.)

## Command packet format

All normal commands sent through `CMD` (`0xA951`) use this envelope.
Generic commands sent through `BUFFER` (`0xA952`) use the same envelope.

Native bitmap data is an exception. It uses the special buffer packet format
described in the bitmap-upload section.

```text
[CMD_GRP][CMD_ID][LEN:2 BE][PAYLOAD][CRC16:2 BE]
```

The packet length is `6 + LEN` bytes. `CRC16` is calculated over the group,
ID, length, and payload. It is appended in big-endian order.

### CRC-16/MODBUS

The packet checksum is CRC-16/MODBUS:

- Reflected polynomial: `0xA001`
- Initial value: `0xFFFF`
- Final XOR: `0x0000`
- Byte order: big-endian

This checksum is used by the generic command packet builder in
`static/ledshow.js`.

### `0x05 0x03` — Play built-in animation

The current library sends:

```text
[INDEX, 0x00, 0x00, 0x64]
```

`INDEX` is validated from `0` to `18`. The meaning of the remaining fixed
bytes is not confirmed.

### `0x06 0x01` — Spectrogram session start/stop

This command controls the special spectrogram streaming session.

- Payload `[0x01]`: start session
- Payload `[0x00]`: stop session

A spectrogram stream must be started with `0x06 0x01` before sending
`0x06 0x02` frames.

The native bitmap upload sequence does **not** use this command.

### `0x01 0x04` on `BUFFER` — Unconfirmed legacy bitmap format

This is a separate bitmap format observed in one capture. Its payload structure
has not been decoded and it is not used by the current library.

The implemented native upload uses a different special `BUFFER` packet.

## Command reference

All commands below are on `CMD` (`0xA951`) unless noted otherwise. Every
example is a **verified real capture** with a passing CRC unless marked
otherwise.

### `0x00 0x01` — Set brightness

- **Payload**: `[ VALUE ]` (1 byte, 0–255)
- **Example** (value=2): `00 01 00 01 02 ad a5`
- Confirmed via extensive live testing (the app's Brightness slider).
  *(An independent write-up suggested this opcode is instead a
  "quick state switch" with values like `0x60`/`0x62`/`0x63` meaning
  off/demo/on — this looks like a misreading of consecutive slider-drag
  values, since 0x60–0x63 are just adjacent brightness levels. Rejected in
  favor of the tested, working behavior.)*

### `0x00 0x02` — Set speed

- **Payload**: `[ VALUE ]` (1 byte, 0–255)
- **Example** (value=1): `00 02 00 01 01 e8 e5`
- Confirmed against 100 real samples from a slider drag (sequential
  values 0x01–0x64, every single CRC matched).

### `0x00 0x04` — Set display effect

- **Payload**: `[ EFFECT ]` (1 byte, 0–7)
- **Effect values**: `0`=Static, `1`=Left, `2`=Right, `3`=Up, `4`=Down,
  `5`=Snow, `6`=Scroll, `7`=Laser
- **Example** (effect=1, Left): `00 04 00 01 01 60 e5`
- Confirmed via live testing (the app's effect picker). *(Same
  independent write-up mislabeled this opcode as brightness, reusing this
  exact byte sequence as "brightness level 1" — rejected for the same
  reason as above: it's byte-identical to the already-tested, working
  Left-scroll effect.)* An earlier draft of this doc described the effect
  as a 3-byte "code" (e.g. `01 60 e5` for Left) — the last 2 of those 3
  bytes are just this command's CRC, not part of the effect identity.

### `0x01 0x02` — Set active program

Activates a previously-uploaded program/slot (e.g. after a bitmap
upload finishes).

- **Payload**: `[ ID ]` (1 byte) — only ever observed as `0x01`
- **Example**: `01 02 00 01 01 28 d8`
- Packet-level structure confirmed (valid CRC, consistent across two
  independent captures); only ever seen with `ID=1` so its full range
  isn't confirmed.

### `0x03 0x01` — Enter Free Draw mode

- **Payload**: `[ 0x01 ]` (fixed)
- **Example**: `03 01 00 01 01 ac a1`
- Must be sent once before `0x03 0x02` (draw pixel) commands. Confirmed
  via extensive live testing (the app's Draw tab).

### `0x03 0x02` — Draw/clear one pixel (Free Draw mode)

- **Payload** (3 bytes): `[ ON_OFF, ROW, (GROUP<<4)|COL_IN_GROUP ]`
  - `ON_OFF`: `0x00` = light the pixel, `0x04` = clear it
  - `ROW`: 0–11 (a full byte, top 4 bits unused since the grid is 12 rows)
  - high nibble = column group (`col / 16`, 0–2 since 48 cols = 3×16),
    low nibble = column within that group (`col % 16`, 0–15)
- **Example** (row=5, col=20 → group=1, col-in-group=4, on): payload =
  `00 05 14` → full packet `03 02 00 03 00 05 14 f9 2a`
- Confirmed via extensive live testing. A full-frame redraw is 576
  individual packets (12×48), one per pixel — there's no confirmed bulk
  version of this command.

### `0x04 0x01` — unconfirmed (only one sample)

- **Payload** (9 bytes), one real capture: `00 60 05 64 64 1e 92 54 3b`
- **Full example**: `04 01 00 09 00 60 05 64 64 1e 92 54 3b 91 d2`
- Seen once, immediately before a `BUFFER` bitmap-data write and a
  `0x01 0x02` (set active program) — i.e. it looks like a "configure
  upload" step in a bitmap/animation-upload sequence. Field-level meaning
  is **not** confirmed: an independent write-up proposed
  `[SLOT, EFFECT_ID, SPEED, PARAM1, PARAM2, HOLD_TIME, ...]`, but applying
  that breakdown to the *correct* bytes (their transcription had one byte
  wrong — `06` where the real capture has `60`, confirmed by CRC) gives
  `EFFECT_ID=0x60`, which is nonsensical for a 0–7 effect selector. With
  only one sample, this command's fields are open.

### `0x05 0x03` — Play built-in animation

- **Payload** (4 bytes): `[ INDEX, 0x00, 0x00, 0x64 ]`
- `INDEX`: 0–18 (19 built-in animations)
- **Example** (index=7): `05 03 00 04 07 01 64 64 6b 39`
- Confirmed via extensive live testing. The trailing `01 64 64` is a fixed
  constant across all 19 captured animations, purpose unconfirmed
  (possibly a fixed style/speed/repeat setting the official app never
  varies). **Note**: earlier versions of this library stored a 19-entry
  "hash" lookup table (one seemingly-opaque 2-byte value per animation
  index) sourced from real captures. Verified against all 19 values: every
  single one is exactly the CRC-16/MODBUS of `05 03 00 04 <index> 01 64 64`
  — there was never a lookup table, just this same checksum computed per
  index. The library now computes it generically instead of storing it.

### `0x06 0x01` — Session start/stop

A general "enter/exit special session" toggle — **not** spectrogram-only.
Confirmed (via direct testing feedback) to also gate the bitmap-upload
sequence, so this should be sent before either a spectrogram stream or an
upload, and the stop variant after.

- **Payload**: `[ 0x01 ]` (start) or `[ 0x00 ]` (stop)
- **Examples**:
  - Start: `06 01 00 01 01 ac 6d`
  - Stop: `06 01 00 01 00 6c ac`

### `0x06 0x02` — Spectrogram frame

- **Payload** (13 bytes): `[ MODE, BAR_0, BAR_1, ..., BAR_11 ]`
  - `MODE`: `0` = bottom-up bars, `1` = center-symmetric bars — **the
    device renders this layout itself**; this isn't just a client-side
    preview choice, the badge honors it natively.
  - `BAR_0`–`BAR_11`: **12** bar-height bytes (not 10 — an earlier draft
    of this doc assumed a 10-band layout based on a different family of
    LED badges; the real payload length here is 13 bytes = 1 mode byte +
    12 bars, confirmed directly from the declared `LEN` field with no
    leftover bytes). Each is a full byte, values `0x00`–`0x08` observed
    (assumed range 0–8, matching the "how many rows lit" semantics; the
    true max hasn't been independently pushed past 8).
- **Example** (mode=1/center, all bars=1): `06 02 00 0d 01 01 01 01 01 01
  01 01 01 01 01 01 01 e7 c4`
- Must be preceded by `0x06 0x01` (session start).

### Native bitmap buffer packet on `BUFFER` (`0xA952`)

The implementation uses a special packet, not the generic command envelope:

```text
01 02 <SLOT> 00 00 <LEN:2 BE> 00 00 <LEN:2 BE> <BITMAP DATA> <CRC16>
```

`LEN` is the length of the encoded bitmap data. The packet is built by
`LedShow._bufferBitmapPacket()`. The CRC16 covers the complete special header
and bitmap data, excluding the CRC bytes.

### `0x02 0x01` (`Upload Start`) + native `BUFFER` bitmap packet +
`0x01 0x02` (activate)

-- **No Session Start/Stop is involved.** `uploadBitmap()` does not call
  `sessionStart()` or `sessionStop()`. Those commands are used for the
  spectrogram stream only.

### `0x02 0x01` (`Upload Start`) + `BUFFER` bitmap chunk + `0x01 0x02` (activate) — **complete real working sequence captured**

```
1. CMD    (0xA951): 02 01 00 0a  <10-byte payload>            <CRC16>   -- Upload Start
   NOTIFY (0xA953): 02 01 00 01  <1-byte status>               <CRC16>   -- device ACK
2. BUFFER (0xA952): 01 02 01 00  00 <LEN:2 BE> 00 00 <LEN:2 BE> <payload> <CRC16>  -- bitmap chunk
   NOTIFY (0xA953): (9 bytes, format not fully decoded)                   -- device ACK
3. CMD    (0xA951): 01 02 00 01  01                            <CRC16>   -- Set Active Program
   NOTIFY (0xA953): 01 02 00 01  01                            <CRC16>   -- device echoes it back
```

This is no longer a hypothesis — it's a **complete real capture** of the
official app successfully performing an upload, including the device's
own ACK notifications at every step (something no earlier capture had).
A few things this settles:

- **No Session Start/Stop involved.** An earlier version of this library's
  `uploadBitmap()` wrapped the sequence in `sessionStart()`/`sessionStop()`
  (`0x06 0x01`) based on a different capture's inline note that session
  start was "valid also for bitmap". This real, complete, successful
  sequence contains **no `0x06 0x01` traffic at all**. That assumption was
  wrong and has been removed from the library.
- **The device does ACK Upload Start explicitly**: `02 01 00 01 01 6c 9c`
  — same opcode echoed back, 1-byte payload, `0x01` = accepted. (An
  earlier, different single-shot capture showed status `0x03` on what
  looked like a rejected/aborted attempt — consistent with this being a
  real status code, not filler.) `ledshow.js` now listens on `NOTIFY`
  (`0xA953`) and checks this byte, throwing a clear error if the device
  reports anything other than `0x01`, instead of silently hoping the
  write worked.
- **`Set Active Program`'s ACK just echoes the command** — not very
  informative on its own, but confirms the device processed it.
- **The Buffer chunk's ACK** (`01 01 00 00 00 01 01 00 00`, 9 bytes)
  doesn't decode cleanly against the generic envelope and isn't otherwise
  understood — `ledshow.js` just drains it (records that *something* came
  back) rather than trying to interpret it.

**`Upload Start`'s payload — mostly mapped now, one field still open:**

```
02 01 00 0a <BITMAP LEN:2 BE> <EFFECT> <SPEED> <BRIGHT> <BITMAP CRC32C> 00 <CRC16>
```
- `BITMAP LEN` (bytes 0–1): confirmed — always exactly matches the accompanying
  `EFFECT`(byte 2):  `0x00` to `0x7` for effects type
- `SPEED` (byte 3): `0x00` to `0x64` for 0% to 100%
- `BRIGHT` (byte 4): `0x00` to `0x64` for 0% to 100%
- `BITMAP CRC32C` (byte 5-8): CRC32C of next encoded bitmap buffer
- Final byte: constant `0x00` across all three samples.


#### Implementation status

`static/ledshow.js` implements the complete native bitmap upload flow,
including:

- `encodeBitmap12()`
- CRC-32C/Castagnoli calculation
- Upload Start acknowledgement handling
- The special bitmap `BUFFER` packet
- Buffer acknowledgement handling
- Program activation
- Session start and session stop
## Confirmed working values quick-reference

| Constant | Value |
|---|---|
| Grid size | 12 rows × 48 columns |
| Packet envelope | `CMD_GRP(1) + CMD_ID(1) + LEN(2, big-endian) + PAYLOAD(LEN) + CRC16(2, big-endian)` |
| CRC algorithm | CRC-16/MODBUS (poly `0x8005` reflected, init `0xFFFF`, no xorout) |
| CRC algorithm | CRC-32/CASTAGNOLI (for bitmap encode) |
| Animation indices | 0–18 (19 total) |
| Effect indices | 0–7 (Static, Left, Right, Up, Down, Snow, Scroll, Laser) |
| Brightness range | 100 |
| Speed range | 100 |
| Spectrogram bars per frame | **12**, each 0–8, plus 1 mode byte (0=bottom, 1=center) |