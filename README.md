# Linux i webbläsaren (v86)

En fristående webbapp som kör riktig Linux i webbläsaren med x86-emulatorn
[v86](https://github.com/copy/v86) (WebAssembly) och en seriell terminal i
[xterm.js](https://xtermjs.org). Alla filer (emulator, BIOS, Linux-avbilder)
ligger lokalt i mappen – appen fungerar offline (utom nätverket inne i gästen).

## System att välja mellan

| System | Filer | Uppstart | Kommentar |
|---|---|---|---|
| **Alpine Linux 3.24** | `images/vmlinuz-virt`, `images/initramfs-virt`, `images/alpine-virt-3.24.2-x86.iso` | ca 15–40 s | Officiell Alpine x86 (kärna 6.18). Loggar in som `root` automatiskt. Pakethanteraren `apk` + nätverk. |
| **Buildroot (snabb demo)** | `images/buildroot-bzimage68.bin` | ca 3 s | Liten BusyBox-Linux (kärna 6.8) från copy.sh. Ingen pakethanterare. |
| **Linux 4 ISO** | `images/linux4.iso` | några s | Liten Linux från copy.sh, används via VGA-skärmen. |

## Kör lokalt

```bash
cd linux-emu
python3 -m http.server 8080
```

Öppna sedan <http://localhost:8080/>. (Det går inte att öppna `index.html`
direkt som fil – webbläsaren kräver en webbserver för att ladda WebAssembly.)

1. Välj system, nätverk och RAM.
2. Tryck **▶ Starta**. Statusraden visar förloppet.
3. Klicka i terminalen och skriv. Text kan också klistras in via rutan
   under terminalen (**Skicka till terminalen** eller Ctrl+Enter), eller med
   Ctrl+Shift+V / högerklick direkt i terminalen.
4. **⏸ Stoppa** pausar maskinen, **▶ Fortsätt** kör vidare, **↻ Starta om**
   startar om från början.
5. **💾 Spara läge** laddar ner maskinens hela tillstånd som en fil,
   **📂 Återställ läge** läser in den igen (välj samma system först).

## Installera program (Alpine)

Med nätverk påslaget (publik relay `wss://relay.widgetry.org/`), tryck på
**🌐 Nätverk + apk** när Alpine har startat, eller skriv själv:

```sh
udhcpc -i eth0
setup-apkrepos -1        # eller skriv repo-adresser i /etc/apk/repositories
apk update
apk add nano htop python3
```

Observera: Alpine körs från en live-CD i RAM. Installerade paket försvinner
vid omstart – använd **Spara läge** för att behålla dem.

Nätverket går via en publik relay (en WebSocket-proxy) som drivs av
tredje part; den kan vara långsam eller nere. Alternativ i menyn:
*Fetch* (endast HTTP via webbläsaren) eller en egen relay, t.ex. en lokal
[wisp-server](https://github.com/MercuryWorkshop/wisp-server-node)
(`wisp://localhost:6001/`).

## Lägga upp på webben

Appen är helt statisk. Ladda upp innehållet i mappen (eller packa upp
`linux-emu.zip`) på valfri statisk webbhotell, t.ex.:

- **GitHub Pages:** lägg filerna i ett repo, gå till *Settings → Pages* och
  välj grenen. (Alpine-ISO:n är ca 51 MB – GitHub varnar för filer över
  50 MB men tillåter upp till 100 MB.)
- Netlify, Cloudflare Pages, Vercel, en vanlig nginx/Apache osv.

Servern måste leverera `.wasm` (helst med MIME-typen `application/wasm`)
och tillåta stora filer. HTTPS krävs för `wss://`-nätverket på de flesta sidor.

## Begränsningar

- Emulatorn körs helt i webbläsarens sandlåda. **Den har ingen åtkomst till
  riktig hårdvara** – inte till datorns diskar, USB, grafikkort, ljud,
  nätverkskort eller filer. Allt i gästen är emulerat (32-bitars x86).
  Appen är alltså till för att köra och lära sig programvara *inne i den
  virtuella maskinen*, inte för att komma åt värddatorns enheter.
- Prestandan är betydligt lägre än på riktig hårdvara.
- Endast 32-bitars (i686) program fungerar.

## Licenser

v86 (BSD-2, `lib/LICENSE-v86`), xterm.js (MIT, `vendor/LICENSE-xterm`),
SeaBIOS (LGPLv3), Linux-kärnan och Alpine/Buildroot (GPL m.fl.).
