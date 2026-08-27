/**
 * Service worker: vermittelt zwischen Popup, Top-Frame-UI und allen Sub-Frames
 * und besorgt die Tab-Audio-Capture-Stream-ID.
 */

const CONTENT_JS = [
  "src/content/common.js",
  "src/content/media.js",
  "src/content/analyzer.js",
  "src/content/ui.js",
  "src/content/main.js"
];
const CONTENT_CSS = ["src/content/overlay.css"];

function sendToTab(tabId, msg, frameId) {
  const opts = typeof frameId === "number" ? { frameId } : undefined;
  return chrome.tabs.sendMessage(tabId, msg, opts).catch(() => null);
}

async function ensureContentScript(tabId) {
  const pong = await sendToTab(tabId, { t: "ping" }, 0);
  if (pong && pong.ok) return true;
  try {
    await chrome.scripting.insertCSS({ target: { tabId, allFrames: true }, files: CONTENT_CSS });
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: CONTENT_JS });
    return true;
  } catch (err) {
    console.warn("[bpm] Content-Script konnte nicht injiziert werden:", err);
    return false;
  }
}

/**
 * Holt eine Tab-Capture-Stream-ID und laesst den Top-Frame daraus einen
 * MediaStream ziehen. Braucht activeTab (Klick auf das Icon oder Shortcut).
 */
async function startCapture(tabId) {
  const injected = await ensureContentScript(tabId);
  if (!injected) return { ok: false, error: "Auf dieser Seite darf die Extension nicht laufen (z. B. Chrome Web Store oder chrome://)." };

  let streamId;
  try {
    streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId, consumerTabId: tabId });
  } catch (err) {
    return { ok: false, error: "Tab-Audio nicht verfuegbar: " + (err && err.message ? err.message : String(err)) };
  }
  const res = await sendToTab(tabId, { t: "beginCapture", streamId }, 0);
  if (!res) return { ok: false, error: "Die Seite hat nicht geantwortet. Seite neu laden und erneut versuchen." };
  return res;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = msg && msg.tabId != null ? msg.tabId : sender.tab && sender.tab.id;
  if (tabId == null) { sendResponse({ ok: false, error: "Kein Tab-Kontext." }); return false; }

  switch (msg.t) {
    // Popup / Shortcut -> Capture starten
    case "startCapture":
      startCapture(tabId).then(sendResponse);
      return true;

    // Sub-Frame -> Top-Frame (Media-Status melden)
    case "toTop":
      sendToTab(tabId, msg.payload, 0).then(() => sendResponse({ ok: true }));
      return true;

    // Top-Frame -> alle Frames (Rate anwenden, Media abfragen)
    case "toAllFrames":
      sendToTab(tabId, msg.payload).then(() => sendResponse({ ok: true }));
      return true;

    // Popup -> Top-Frame (State lesen / Kommando schicken)
    case "toContent":
      (async () => {
        await ensureContentScript(tabId);
        const res = await sendToTab(tabId, msg.payload, 0);
        sendResponse(res || { ok: false, error: "Keine Antwort von der Seite." });
      })();
      return true;

    default:
      return false;
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-panel") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id == null) return;
  await ensureContentScript(tab.id);
  const res = await sendToTab(tab.id, { t: "togglePanel" }, 0);
  // Panel wurde geoeffnet und will Audio: Shortcut zaehlt als User-Geste -> activeTab.
  if (res && res.wantsCapture) await startCapture(tab.id);
});
