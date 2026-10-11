"use strict";
/* Linux i webbläsaren – v86 + xterm.js */

const ALPINE_REPO = "http://dl-cdn.alpinelinux.org/alpine/v3.24";

const PROFILES = {
  alpine: {
    name: "Alpine Linux 3.24 (pakethanterare apk, nätverk)",
    info: "Fullständig Alpine Linux (kärna 6.18) från den officiella x86-ISO:n. Loggar in automatiskt som root. " +
          "Tryck på ”Nätverk + apk” efter uppstart, sedan kan du installera program, t.ex. apk add python3 nano htop.",
    memory: 512,
    net: true,
    autologin: "root",
    config: {
      bzimage: { url: "images/vmlinuz-virt" },
      initrd: { url: "images/initramfs-virt" },
      cdrom: { url: "images/alpine-virt-3.24.2-x86.iso" },
      cmdline: "console=tty0 console=ttyS0,115200 modules=loop,squashfs,sd-mod,sr-mod,cdrom,isofs " +
               "alpine_dev=cdrom:iso9660 modloop=/boot/modloop-virt quiet tsc=reliable mitigations=off random.trust_cpu=on",
    },
    readyRe: /:~# $/,
  },
  buildroot: {
    name: "Buildroot Linux (snabb minidemo, ~10 s)",
    info: "Liten Buildroot-Linux (BusyBox) som startar på några sekunder. Ingen pakethanterare.",
    memory: 128,
    net: false,
    config: {
      bzimage: { url: "images/buildroot-bzimage68.bin" },
      cmdline: "tty0 console=ttyS0 tsc=reliable mitigations=off random.trust_cpu=on",
    },
    readyRe: /[#$%] $/,
  },
  linux4: {
    name: "Linux 4 ISO (endast VGA-skärm)",
    info: "Klassisk liten Linux-ISO från copy.sh. Använder VGA-skärmen till höger – klicka på skärmen och skriv.",
    memory: 128,
    net: false,
    config: { cdrom: { url: "images/linux4.iso" } },
    readyRe: null,
  },
};

const $ = (id) => document.getElementById(id);
const els = {
  profile: $("profile"), network: $("network"), customNet: $("customNet"), memory: $("memory"),
  start: $("btnStart"), stop: $("btnStop"), restart: $("btnRestart"),
  save: $("btnSave"), restore: $("btnRestore"), stateFile: $("stateFile"),
  status: $("status"), statusText: $("statusText"), bar: $("progressBar"), info: $("profileInfo"),
  paste: $("pasteText"), btnPaste: $("btnPaste"),
};

for (const [key, p] of Object.entries(PROFILES)) {
  const o = document.createElement("option");
  o.value = key; o.textContent = p.name;
  els.profile.appendChild(o);
}
const extra = document.createElement("button");
extra.id = "btnNet"; extra.textContent = "🌐 Nätverk + apk"; extra.disabled = true;
extra.title = "Startar DHCP på eth0 och lägger till Alpines paketförråd (apk update)";
document.querySelector(".btns").prepend(extra);

function updateInfo() {
  const p = PROFILES[els.profile.value];
  els.info.textContent = p.info;
  els.memory.value = String(p.memory);
  if (!p.net) els.network.value = ""; else if (!els.network.value) els.network.value = "wss://relay.widgetry.org/";
  extra.hidden = els.profile.value !== "alpine";
}
els.profile.addEventListener("change", updateInfo);
els.network.addEventListener("change", () => { els.customNet.hidden = els.network.value !== "custom"; });
updateInfo();

/* ---------- Terminal ---------- */
const term = new Terminal({
  cursorBlink: true, convertEol: false, fontSize: 14, scrollback: 5000,
  fontFamily: 'ui-monospace, "DejaVu Sans Mono", Menlo, Consolas, monospace',
  theme: { background: "#000000", foreground: "#d7dae0", cursor: "#4cc38a" },
});
const fit = new FitAddon.FitAddon();
term.loadAddon(fit);
term.open($("terminal"));
window.term = term;
fit.fit();
window.addEventListener("resize", () => fit.fit());
term.writeln("\x1b[90mVälkommen! Välj ett system och tryck på \x1b[32mStarta\x1b[90m.\x1b[0m");

/* ---------- State ---------- */
let emulator = null;
let state = "idle";          // idle | loading | running | stopped
let bootStart = 0;
let booted = false;
let serialTail = "";
let autologinDone = false;
let outBuf = [];
let flushScheduled = false;
window.bootSeconds = null;

function setStatus(text, cls) {
  els.statusText.textContent = text;
  els.status.className = "status " + (cls || "");
}
function setProgress(f) { els.bar.style.width = Math.max(0, Math.min(100, f * 100)) + "%"; }
function updateButtons() {
  const has = !!emulator;
  els.start.disabled = state === "running" || state === "loading";
  els.start.textContent = state === "stopped" ? "▶ Fortsätt" : "▶ Starta";
  els.stop.disabled = state !== "running";
  els.restart.disabled = !has;
  els.save.disabled = !(state === "running" || state === "stopped");
  els.profile.disabled = state === "running" || state === "loading" || state === "stopped";
  els.network.disabled = els.memory.disabled = els.profile.disabled;
  extra.disabled = state !== "running" || !booted;
}

function serialSend(text) {
  if (emulator) emulator.serial0_send(text);
}
term.onData((d) => serialSend(d));

function flushOut() {
  flushScheduled = false;
  if (outBuf.length) { term.write(new Uint8Array(outBuf)); outBuf = []; }
}

function onSerialByte(b) {
  outBuf.push(b);
  if (!flushScheduled) { flushScheduled = true; requestAnimationFrame(flushOut); setTimeout(flushOut, 50); }
  const ch = String.fromCharCode(b);
  serialTail = (serialTail + ch).slice(-300);
  const p = PROFILES[currentProfile];
  if (!booted) {
    if (/Linux version/.test(serialTail) && !/Kärnan/.test(els.statusText.textContent)) {
      setStatus("Kärnan startar… (" + elapsed() + " s)", "loading");
      setProgress(0.4);
    } else if (/Run \/init|Starting|OpenRC|\* /.test(serialTail.slice(-40)) && els.bar.style.width === "40%") {
      setStatus("Startar tjänster (init)… (" + elapsed() + " s)", "loading");
      setProgress(0.7);
    }
    if (p.autologin && !autologinDone && /login: $/.test(serialTail)) {
      autologinDone = true;
      setStatus("Loggar in som " + p.autologin + "… (" + elapsed() + " s)", "loading");
      setProgress(0.9);
      setTimeout(() => serialSend(p.autologin + "\n"), 200);
    }
    if (p.readyRe && p.readyRe.test(serialTail)) markBooted();
  }
}

function elapsed() { return ((performance.now() - bootStart) / 1000).toFixed(1); }

function markBooted() {
  booted = true;
  window.bootSeconds = parseFloat(elapsed());
  setStatus("✔ Linux är igång – uppstart tog " + window.bootSeconds + " s. Klicka i terminalen och skriv.", "running");
  setProgress(1);
  updateButtons();
  term.focus();
}

let currentProfile = els.profile.value;

function networkUrl() {
  const v = els.network.value;
  if (v === "custom") return els.customNet.value.trim();
  return v;
}

function createEmulator(initialState) {
  currentProfile = els.profile.value;
  const p = PROFILES[currentProfile];
  booted = false; autologinDone = false; serialTail = "";
  term.reset();
  const cfg = Object.assign({
    wasm_path: "lib/v86.wasm",
    memory_size: parseInt(els.memory.value, 10) * 1024 * 1024,
    vga_memory_size: 8 * 1024 * 1024,
    bios: { url: "bios/seabios.bin" },
    vga_bios: { url: "bios/vgabios.bin" },
    screen_container: $("screen_container"),
    autostart: true,
    acpi: false,
  }, p.config);
  const net = networkUrl();
  if (net) cfg.net_device = { type: "ne2k", relay_url: net };
  if (initialState) cfg.initial_state = { buffer: initialState };

  bootStart = performance.now();
  state = "loading";
  setStatus("Laddar emulatorn…", "loading");
  setProgress(0.02);
  updateButtons();

  emulator = new V86(cfg);
  window.emulator = emulator;

  emulator.add_listener("download-progress", (e) => {
    const pct = e.lengthComputable && e.total ? Math.round(100 * e.loaded / e.total) : null;
    const name = (e.file_name || "").split("/").pop();
    setStatus(`Laddar fil ${e.file_index + 1}/${e.file_count}: ${name}` + (pct !== null ? ` (${pct} %)` : ""), "loading");
    setProgress(0.3 * ((e.file_index + (pct || 0) / 100) / e.file_count));
  });
  emulator.add_listener("download-error", (e) => {
    setStatus("Fel: kunde inte ladda " + e.file_name, "error");
  });
  emulator.add_listener("emulator-ready", () => {
    state = "running";
    if (initialState) {
      booted = true;
      setStatus("✔ Sparat läge återställt – maskinen körs.", "running");
      setProgress(1);
    } else if (!p.readyRe) {
      setStatus("Körs – se VGA-skärmen (klicka på den för att skriva).", "running");
      setProgress(1);
      booted = true;
    } else {
      setStatus("BIOS startar… (" + elapsed() + " s)", "loading");
      setProgress(0.32);
    }
    updateButtons();
  });
  emulator.add_listener("serial0-output-byte", onSerialByte);
}

/* ---------- Buttons ---------- */
els.start.addEventListener("click", () => {
  if (state === "stopped" && emulator) {
    emulator.run(); state = "running";
    setStatus(booted ? "✔ Körs igen." : "Fortsätter uppstarten…", booted ? "running" : "loading");
    updateButtons(); term.focus();
    return;
  }
  createEmulator(null);
});

els.stop.addEventListener("click", () => {
  if (!emulator) return;
  emulator.stop(); state = "stopped";
  setStatus("⏸ Pausad. Tryck på Fortsätt för att köra vidare.", "");
  updateButtons();
});

els.restart.addEventListener("click", async () => {
  if (!emulator) return;
  try { await emulator.destroy(); } catch (e) {}
  emulator = null;
  createEmulator(null);
});

els.save.addEventListener("click", async () => {
  if (!emulator) return;
  const prev = els.statusText.textContent;
  setStatus("Sparar läge…", "loading");
  try {
    const buf = await emulator.save_state();
    const blob = new Blob([buf]);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `v86-${currentProfile}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.bin`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    setStatus("💾 Läget sparat (" + (buf.byteLength / 1048576).toFixed(1) + " MB). " +
              "Välj samma system innan du återställer.", state === "running" ? "running" : "");
  } catch (e) {
    setStatus("Fel vid sparande: " + e.message, "error");
  }
});

els.restore.addEventListener("click", () => els.stateFile.click());
els.stateFile.addEventListener("change", async () => {
  const f = els.stateFile.files[0];
  if (!f) return;
  const buf = await f.arrayBuffer();
  els.stateFile.value = "";
  const m = /v86-(\w+)-/.exec(f.name);
  if (m && PROFILES[m[1]] && !emulator) { els.profile.value = m[1]; updateInfo(); }
  if (emulator) {
    try {
      await emulator.restore_state(buf);
      emulator.run(); state = "running"; booted = true;
      setStatus("✔ Sparat läge återställt.", "running"); setProgress(1);
      updateButtons(); term.focus();
    } catch (e) { setStatus("Fel vid återställning: " + e.message, "error"); }
  } else {
    createEmulator(buf);
  }
});

function sendPaste() {
  let t = els.paste.value;
  if (!t) return;
  t = t.replace(/\r\n?/g, "\n");
  if (!t.endsWith("\n")) t += "\n";
  // Skicka i små bitar så att gästens buffert hinner med
  const chunks = t.match(/[\s\S]{1,64}/g);
  let i = 0;
  (function next() { if (i < chunks.length) { serialSend(chunks[i++]); setTimeout(next, 30); } })();
  els.paste.value = "";
  term.focus();
}
els.btnPaste.addEventListener("click", sendPaste);
els.paste.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.ctrlKey) { e.preventDefault(); sendPaste(); } });

extra.addEventListener("click", () => {
  serialSend(
    "ip link set eth0 up && udhcpc -i eth0 -q && " +
    `printf '%s\\n' ${ALPINE_REPO}/main ${ALPINE_REPO}/community > /etc/apk/repositories && ` +
    "apk update && echo 'KLART - prova nu t.ex.: apk add nano htop python3'\n");
  term.focus();
});

window.addEventListener("paste", (e) => {
  // Klistra in direkt i terminalen hanteras av xterm.js (Ctrl+Shift+V / högerklick)
});
updateButtons();
