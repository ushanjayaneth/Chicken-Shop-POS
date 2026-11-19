# Counter printers and barcode scanners

Open **Settings → Printers & scanners**. Choose a connection method, enter the device's documented settings, press **Save setup**, then **Choose & connect** (or **Connect to address**). Permission choosers open only after that click. **Print test receipt** sends output to the selected printer route. Normal sale receipts use the same route.

Saved settings belong to this browser profile and branch. The app attempts to reopen only previously authorized devices at startup, on focus / online / USB-connect events, and periodically while open. **Disconnect** disables automatic reconnection until you connect again. Clearing browser site data or revoking permission requires choosing the device again. Several identical serial or USB devices without unique serial numbers require an explicit selection rather than guessing.

## Connection indicators

- **Green: Channel connected** means a browser device channel is open, or the configured LAN printer TCP port responded. It does not confirm paper, ink, cutter operation or a printed receipt.
- **Red: Disconnected** means the configured direct channel is absent or failed. Read the status message before reconnecting. An open serial channel can only detect disconnection when the OS reports it or I/O fails.
- **Red: Connection unverified** is used for OS printing and keyboard scanners. A browser cannot continuously detect their physical connection. A successful scan confirms received input, not continuing presence.

## USB / Bluetooth keyboard barcode scanners

This is the usual scanner setup. Connect USB or pair the scanner in the operating system's Bluetooth settings. Configure keyboard / HID mode and an **Enter suffix** using the scanner manual. Scan while the POS is open to add the matching product; repeated scans increase quantity. Settings has a separate scanner test field. Standard keyboard scanners do not need a browser device chooser.

The POS recognizes barcode, SKU and supported device serial / IMEI matches. Serialized devices must be available in the selected branch. Unknown or unavailable codes produce a message rather than adding an unrelated product. Recognized codes followed by Enter add products while the POS is open. Codes received during saved-cart loading wait until the draft is ready. Form inputs retain their usual text entry.

## Receipt printers

| Route | Requirements | Output |
| --- | --- | --- |
| OS printer / browser dialog | Install the printer's OS driver or pair it in OS Bluetooth settings | Existing styled receipt and browser print dialog; select the physical printer there |
| USB direct | ESC/POS printer with an accessible printer/vendor bulk-output USB interface; browser WebUSB permission | ESC/POS text, feed and cut |
| USB / Bluetooth serial | ESC/POS printer exposed as a serial / COM port; match baud rate | ESC/POS text, feed and cut |
| Bluetooth LE | Device manufacturer's GATT service and writable characteristic UUIDs; characteristic accepts ESC/POS | ESC/POS bytes in 20-byte writes |
| LAN / Wi-Fi | Local branch hub and private LAN address / raw TCP port, usually 9100 | ESC/POS text, feed and cut through the hub |

Direct printing supports ASCII text. Unsupported characters become `?`; the browser / OS route supports styled Unicode receipts. User receipt text is filtered so embedded control bytes cannot become printer commands. Driver ownership can block WebUSB, especially on Windows; use the OS printer route in that case. Bluetooth Classic is supported through an OS serial port or OS printer driver, rather than the Bluetooth LE chooser.

The direct route never silently falls back to a second printer after an error. Check the paper before retrying: a failed transfer might already have sent part of a receipt. Printing is never automatically retried after bytes may have been transmitted. Raw cutter support varies by printer. Cash-drawer pulses are not sent.

## Direct scanner channels

Serial, Bluetooth LE and LAN scanner channels support printable UTF-8 product codes, **1–256 characters**, ending in CR or LF. Split packets and CRLF are supported. Empty lines, embedded control codes and oversized records are ignored. Proprietary HID reports, binary device protocols, UDP and HTTP scanner APIs need a vendor-specific adapter and are not decoded by these modes.

- **USB / Bluetooth serial:** Configure serial / COM mode and the manual's baud rate. Bluetooth serial scanners must first be paired in the operating system.
- **Bluetooth LE:** Enter the manufacturer's service and notification characteristic UUIDs. The characteristic must provide notifications or indications in the line format above. The app does not guess a universal Bluetooth printer/scanner protocol.
- **LAN:** Configure a scanner that provides a TCP server. Enter its private LAN address and listening port. The hub connects to that server and forwards received scans to the active POS. Vendor push-to-PC scanners that require a listener are not supported by this TCP-client mode.

## Browser and hub requirements

WebUSB, Web Serial and Web Bluetooth require a secure context (HTTPS or localhost), browser support, and explicit first-time permission. Supporting desktop Chrome / Edge is recommended; availability varies by OS and device. Some browsers do not expose Bluetooth `getDevices()`, so a saved BLE device may need **Choose & connect** again. The OS / keyboard routes remain available when direct browser APIs are unavailable.

LAN device connections require the **local branch-hub workspace**. A hosted website or standalone device workspace cannot open arbitrary TCP connections. Hub requests require an authenticated owner, manager or cashier with branch access. Hosts must resolve entirely to private IPv4 addresses; the hub pins the validated address before opening a socket. Scanner channels expire after the client stops polling and close when the hub stops. The app does not sweep the network or access hardware until a specific device is configured and authorized.

Reference API behavior: [Chrome WebUSB guide](https://developer.chrome.com/docs/capabilities/usb), [Chrome Web Serial guide](https://developer.chrome.com/docs/capabilities/serial), [Chrome Web Bluetooth guide](https://developer.chrome.com/docs/capabilities/bluetooth).

## Verification

`npx tsx --test tests/hardware-connections.test.ts tests/peripherals.test.ts` uses in-memory browser device mocks and parser validation. It does not operate physical equipment. A real printer/scanner acceptance test still needs the actual device model, its documented protocol and a user-initiated connection / test print.


### Verified upgrade

Verified on 11 November 2026 with isolated sample workspaces. The production build passed. 224 unit tests passed. The browser check connected a mocked USB receipt printer and serial scanner, reloaded the app, observed both saved channels reconnect, scanned through serial and keyboard input, recorded payment and sent the actual receipt as ESC/POS bytes.

Scans received while the saved cart opens are buffered and added after draft restoration. Equipment acceptance still uses the shop's actual printer/scanner and documented connection protocol.
