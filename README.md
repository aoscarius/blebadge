# LedShow Controller

A browser-based controller for cheap Chinese "LedShow" LED badges (12×48 pixel
displays, normally driven by an Android/iOS app over Bluetooth LE). This talks
to the badge directly from the browser using the [Web Bluetooth API](https://developer.chrome.com/docs/capabilities/bluetooth) —
no app install, no native code.

Everything here is the result of reverse-engineering the badge's Bluetooth
protocol by sniffing traffic from the official app. See
[`PROTOCOL.md`](./PROTOCOL.md) for the full protocol writeup, and the
"Known limitations" section below for what's still unconfirmed.

## Requirements

- **Chrome or Edge**, desktop or Android. Web Bluetooth is not supported in
  Firefox or Safari (including iOS Safari, all browsers on iOS).
- **HTTPS or `localhost`.** Web Bluetooth refuses to run over plain `http://`
  or `file://`. Serve the folder with any static file server, e.g.:
  ```bash
  npx serve .
  # or
  python3 -m http.server 8000
  ```
  then open `http://localhost:<port>/index.html`.
- A LedShow badge, powered on and in range.

## Files

| File | Purpose |
|---|---|
| `index.html` | Markup only — the app's structure/tabs. Loads `style.css` and the two scripts below. |
| `style.css` | All styling. |
| `blebadge.js` | App logic: canvas drawing, text rendering, audio FFT, tab switching, animation previews — everything that talks to the DOM. Calls into `ledshow.js` for anything device-related. |
| `ledshow.js` | Standalone BLE protocol library (`class LedShow`). No UI/DOM code at all — just device communication. |
| `PROTOCOL.md` | Full writeup of the BLE GATT protocol, byte-level command layouts, and open questions. |

Keep all four files in the same folder — the HTML loads the others by
relative path.

## Features

- **Connect / Disconnect** — standard Web Bluetooth device picker. See the
  troubleshooting note below if the device shows as "paired" but won't
  connect.
- **Text** — type a message, rendered to a bitmap in the browser and pushed to
  the badge via Free Draw mode. Long text can be scrolled from the browser
  side ("Software scroll") by re-sending shifted frames, since the device's
  own proprietary text-upload format isn't fully cracked yet (see
  `PROTOCOL.md`).
- **Draw** — a 12×48 pixel canvas. Every stroke is sent to the badge live, in
  real time, as you draw (matching the behavior of the original `pyFreeDraw.py`
  script). Save/load your drawing as a PNG.
- **Anim** — the badge's 19 built-in animations, shown as a grid of preview
  thumbnails (real captured GIFs where available). Tap one to play it
  immediately.
- **Music** — live audio spectrum analyzer (microphone or an audio file),
  sent to the badge's built-in spectrogram mode. Two visual styles in the
  browser preview: classic bottom-up bars, or symmetric growth from the
  center rows — pick whichever matches how your unit actually renders it.

## Connecting: common gotcha (Windows)

If your badge shows up as **paired** in Windows Bluetooth settings but the
app can't connect, unpair it from Windows first. Web Bluetooth manages its
own connection and doesn't want the OS to have bonded with the device — a
prior OS-level pairing often holds the single GATT connection slot these
badges support, which blocks the browser's own `gatt.connect()`. Steps:

1. Settings → Bluetooth & devices → find the badge → **Remove device**.
2. Optionally clear it from `chrome://bluetooth-internals/#devices` too.
3. Toggle Bluetooth off/on (or power-cycle the badge).
4. Reconnect from the app's own **Connect** button — don't pre-pair through
   Windows.

## Extending the library

Every normal device command in `static/ledshow.js` is a wrapper around one of
these generic methods:

```js
await led.send(cmdGrp, cmdId, [payloadBytes]);       // CMD characteristic (0xA951)
await led.sendBuf(cmdGrp, cmdId, [payloadBytes]);    // BUFFER characteristic (0xA952)
```

If you reverse-engineer a new command from a BLE sniff, you don't need to
touch any connection or queuing logic — just add:

```js
async someNewFeature(v) {
  await this.send(0xAA, 0xBB, [v]);
}
```

You can also call `led.send(0xAA, 0xBB, [0x01, 0x02])` directly from the
browser console to test a command before wrapping it in a method. The
library builds the packet envelope and CRC automatically.

## Known limitations

- Native bitmap upload is implemented. The library encodes 12×48 bitmaps,
  calculates CRC-32C/Castagnoli, handles upload acknowledgements, sends the
  special bitmap buffer packet, activates the uploaded program, and closes the
  special session.
- Text normally uses browser-side rendering and Free Draw mode because the
  badge's native text commands are separate from the confirmed bitmap-upload
  protocol.
- Spectogram confirmed. The badge takes exactly 12 bar values (0–8)
  plus a mode byte the device itself uses to choose between bottom-up and
  center-symmetric rendering — so the app's "Bottom"/"Center" toggle tells
  the physical badge which layout to draw natively, rather than being a
  local-only preview choice.
- Free Draw sends one BLE write per pixel, up to 576 writes for a complete
  12×48 frame.

## Disclaimer

This is unofficial, reverse-engineered software for a device with no public
protocol documentation. It isn't affiliated with the badge manufacturer.
Use at your own risk.

## Reverse-engineered protocol status

The library uses two checksums:

- **CRC-16/MODBUS** protects normal command packets and the special bitmap
  buffer packet.
- **CRC-32C/Castagnoli** protects the encoded native bitmap data.

Native bitmap upload uses a special session. It is not the same as the
spectrogram preview or other commands, they send different data frames.

The library searches all reachable primary GATT services because badge models
may expose their characteristics under different services.