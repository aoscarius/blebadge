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

**Important:** don't rely on a single "primary service" — some Web
Bluetooth stacks only expose characteristics correctly when you enumerate
*all* primary services on the connected GATT server and search across all
of them for the UUIDs above, rather than assuming they all live under one
service. (This tripped up an earlier version of this app — see the git
history / changelog if working from a fork.)

## Command packet format

Every command observed on the `CMD` (`0xA951`) and `BUFFER` (`0xA952`)
characteristics in this app is **exactly 16 bytes**, and looks like:

```
byte:   0    1    2    3    4    5    6    7    8    9   10   11   12   13   14   15
        [opcode-hi][opcode-lo][ param-hi ][ param-lo ][ ------ payload / padding ------ ]
```

- **Bytes 0–1**: opcode. Byte 0 is a coarse "family" (draw/mode = `0x03`,
  animation = `0x05`, spectrogram = `0x06`, brightness/speed/effect =
  `0x00`), byte 1 selects the specific command within that family.
- **Bytes 2–3**: a secondary parameter field. In several commands this
  lines up with "how many of the following bytes are meaningful", but it
  doesn't hold consistently across every command family (see `setEffect`
  below), so **its exact semantics are not fully confirmed** — treat it as
  command-specific until proven otherwise.
- **Bytes 4–15**: payload, specific to each command, zero-padded to fill
  the 16 bytes.

All values below are hex, byte-separated for readability; `XX` marks a
variable byte, `--` marks a byte whose value hasn't been shown to matter
(commonly zero padding).

### `freeMode()` — enter Free Draw mode

```
03 01 00 01 01 ac a1 00 00 00 00 00 00 00 00 00
```

- `03 01`: opcode = enter-mode.
- `00 01`: param field.
- `01`: mode selector (confirmed: `01` = Free Draw / pixel-grid mode).
- `ac a1`: fixed 2-byte magic/id for this mode (unconfirmed whether it's a
  checksum or just a mode identifier — it's constant across every capture
  of this command).
- rest: zero padding.

Must be sent once before `drawPixel`/`drawFrame` calls.

### `drawPixel(row, col, on)` — set/clear one pixel in Free Draw mode

```
03 02 00 03 MM 0R QC rr rr r0 00 00 00 00 00
```

- `03 02`: opcode = draw pixel.
- `00 03`: param field (3 meaningful bytes follow: `MM`, `0R`, `QC`).
- `MM`: `00` = light the pixel (drawn/red), `04` = clear it. **Confirmed.**
- `0R`: high nibble always `0`, low nibble = **row** (0–11). Confirmed —
  row is a single hex digit since the grid is only 12 rows tall.
- `QC`: high nibble = **column group** (`col / 16`, range 0–2, since
  48 columns / 16 = 3 groups of 16), low nibble = **column within group**
  (`col % 16`, range 0–15). Confirmed by construction — this is how the
  official app's captures decompose every column value 0–47.
- `rr rr r`: a 5-hex-digit (20-bit) field immediately after `QC`, straddling
  byte boundaries (bytes 7–9 above only align on a nibble). The original
  reverse-engineering scripts (`pyHack.py`, `pyFreeDraw.py`) populate this
  with **`random.randrange(16**5)`** on every single pixel write, and the
  device accepts it fine regardless of value — so functionally this field
  appears to be **ignored by the device** (or its real meaning is something
  the badge doesn't validate, e.g. a sequence/frame id). Treat any value
  here as safe; this library also just randomizes it, matching the known
  working behavior.
- remaining bytes: zero padding.

To push a full frame, `drawFrame()` just calls `drawPixel()` for all
12×48 = 576 cells in turn — there's no confirmed "bulk pixel" command, so a
full redraw costs 576 individual BLE writes.

### `animate(index)` — play a built-in animation (0–18)

```
05 03 00 04 II 01 64 64 HH HH 00 00 00 00 00 00
```

- `05 03`: opcode = play animation.
- `00 04`: param field (4 meaningful bytes follow: `II`, `01`, `64`, `64`).
- `II`: animation index, `00`–`12` hex (0–18 decimal). **Confirmed** —
  directly the requested index, zero-padded to a byte.
- `01 64 64`: constant across all 19 captured animation commands. Purpose
  unconfirmed (possibly a fixed style/speed/repeat setting the official app
  never varies).
- `HH HH`: a 2-byte **per-animation hash/id**, one of 19 fixed values (see
  `LedShow.ANIM_HASHES` in `ledshow.js`). **Confirmed required** — sending
  the wrong hash for a given index was not tested and is assumed to fail or
  play the wrong animation, since the official app always pairs each index
  with its own specific hash. These 19 values were captured directly from
  the official app's traffic and are not derivable from the index alone (no
  arithmetic relationship found).
- remaining bytes: zero padding.

### `setBrightness(value)` — global brightness, 0–255

Sent on the **`BUFFER`** characteristic (`0xA952`), not `CMD`.

```
00 01 00 01 VV 6c 24 00 00 00 00 00 00 00 00 00
```

- `00 01`: opcode = set brightness.
- `00 01`: param field.
- `VV`: brightness value, 0–255. **Confirmed** — direct byte value.
- `6c 24`: constant across captures, purpose unconfirmed.
- remaining bytes: zero padding.

### `setSpeed(value)` — animation/scroll speed, 0–255

Also on `BUFFER` (`0xA952`).

```
00 02 00 01 VV 28 24 00 00 00 00 00 00 00 00 00
```

Same structure as brightness, with opcode `00 02` and a different constant
tail (`28 24`).

### `setEffect(effect)` — apply a display effect to currently-loaded content

```
00 04 00 01 EE EE EE 00 00 00 00 00 00 00 00 00
```

- `00 04`: opcode = set effect.
- `00 01`: param field — note this is `1` even though **3 bytes** of effect
  code follow, which is why byte 2–3's meaning is *not* treated as a
  reliable general-purpose "byte count" field elsewhere in this doc.
- `EE EE EE`: a fixed 3-byte code per effect, one of:

  | Effect | Code |
  |---|---|
  | Static | `00 a0 24` |
  | Scroll left | `01 60 e5` |
  | Scroll right | `02 61 a5` |
  | Scroll up | `03 a1 64` |
  | Scroll down | `04 63 25` |
  | Snow | `05 a3 e4` |
  | Scroll (generic) | `06 a2 a4` |
  | Laser | `07 62 65` |

  The leading byte of each code (`00`..`07`) looks like an effect-family
  index that happens to match the order the official app lists them in;
  the trailing 2 bytes don't follow an obvious arithmetic pattern and are
  taken as fixed per-effect constants.
- remaining bytes: zero padding.

### `spectrogramMode()` — enter Audio Spectrogram mode

```
06 01 00 01 01 ac 6d 00 00 00 00 00 00 00 00 00
```

Same shape as `freeMode()` (opcode family `06` instead of `03`, mode
selector `01`, then a fixed 2-byte magic `ac 6d` instead of `ac a1`). The
shared `ac` byte across both modes' magic values, with a differing second
byte per mode, suggests `ac` may be a fixed "enter mode" marker and the
second byte a mode-specific id — but this is inferred from only two data
points and not confirmed.

### `spectrogramFrame(bars[10], side?)` — push one frame of audio-bar data

```
06 02 00 0c 01 0S B0 B1 B2 B3 B4 B5 B6 B7 B8 B9
```

- `06 02`: opcode = spectrogram frame.
- `00 0c`: param field = `0x0c` = 12, matching the 12 payload bytes that
  follow (`01`, `0S`, and 10 bar bytes) — this is the one command where the
  param field cleanly matches "byte count of what follows".
- `01`: constant, purpose unconfirmed.
- `0S`: low nibble = a "side" value 0–9. The official app varies this per
  frame; in this library it defaults to a random 0–9 value when not
  specified. Its exact effect on rendering is unconfirmed — possibly
  related to which half of the display updates first, or a
  flicker/dithering seed.
- `B0`–`B9`: **10 bar-height bytes**, one per frequency bucket, each in the
  low nibble only (range `0x00`–`0x08`, i.e. 0–8). **Confirmed** — this is
  the field this app maps its FFT data into. How the device physically
  lays these 10 values out on the 12×48 grid (spacing, bottom-up vs.
  center-out growth) varies by unit/firmware and is **not part of the wire
  protocol** — it's entirely up to the device's own rendering, which is why
  this app's on-screen preview offers multiple visual styles to match
  different observed behavior rather than asserting one true layout.

## Unconfirmed: custom text upload

The official app can upload a proprietary bitmap/font blob so that text
scrolls natively on-device (rather than this app's client-side
render-and-push-through-Free-Draw workaround). Two full captures of this
sequence exist, each following the same 3-step shape:

1. **Upload Start** (on `CMD`, `0xA951`):
   ```
   02 01 00 0a <LEN(2 bytes)> <8 bytes, purpose unconfirmed — checksum/id?>
   ```
   Example capture:
   ```
   02 01 00 0a 00 bb 01 64 64 8c 58 3d 32 00 50 a7
   ```
2. **Bitmap buffer** (on `BUFFER`, `0xA952`): a long variable-length
   payload starting `01 02 01 00 00 <LEN(2 bytes)> 00 00 <LEN(2 bytes)>`
   followed by a stream of 4-hex-digit big-endian-looking words, then
   trailing zero padding. Believed to encode the glyph bitmap column by
   column, but the exact bit-packing (which bits map to which of the 12
   rows, how column width/kerning is encoded, whether it's per-glyph or a
   single packed string) has **not** been decoded.
3. **Select** (on `CMD`, `0xA951`):
   ```
   01 02 00 01 01 28 d8 00 00 00 00 00 00 00 00 00
   ```
   Identical in both captures — likely just "commit/display the just-loaded
   content", constant regardless of what was uploaded.

Because only two real-world samples exist (both short strings), there
isn't enough data to reliably reverse the bitmap encoding — a real decode
would need several more captures of different, ideally single-character
and progressively longer strings, to isolate how length and per-glyph data
vary. Until then, this app does not use this upload path at all; see the
README's "Known limitations" section.

## Confirmed working values quick-reference

| Constant | Value |
|---|---|
| Grid size | 12 rows × 48 columns |
| Animation indices | 0–18 (19 total) |
| Brightness range | 0–255 |
| Speed range | 0–255 |
| Spectrogram bars per frame | 10, each 0–8 |