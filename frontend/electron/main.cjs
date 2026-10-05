const { app, BrowserWindow, session, ipcMain, globalShortcut, clipboard, nativeImage } = require("electron");
const path = require("path");

let mainWindow = null;
let clipboardWatchdog = null;
let isMeetingActiveInApp = false;
let isHostInApp = false;

// Rapid clipboard sanitizer: Destroys any OS screen capture buffer
const purgeClipboard = () => {
  try {
    clipboard.clear();
    clipboard.writeText("");
    const emptyImg = nativeImage.createEmpty();
    clipboard.writeImage(emptyImg);
  } catch (err) {
    // Ignore clipboard access race errors
  }
};

// Continuous burst purge over 1.5 seconds to wipe delayed Windows OS bitmap writes
const triggerBurstClipboardPurge = () => {
  purgeClipboard();
  const delays = [5, 15, 35, 75, 150, 300, 600, 1000, 1500];
  delays.forEach((delay) => {
    setTimeout(purgeClipboard, delay);
  });
};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: "V2 Meet HD — E2EE Video Conferencing",
    icon: path.join(__dirname, "../public/icon-512.png"),
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, "preload.cjs")
    }
  });

  // Block auxiliary window spawning/popups
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  // Prevent unauthorized remote URL navigation
  mainWindow.webContents.on("will-navigate", (event, navigationUrl) => {
    try {
      const parsed = new URL(navigationUrl);
      if (parsed.origin !== "http://localhost:8000" && parsed.origin !== "http://127.0.0.1:8000" && !navigationUrl.startsWith("file://")) {
        event.preventDefault();
      }
    } catch {
      event.preventDefault();
    }
  });

  mainWindow.webContents.on("console-message", (event, level, message, line, sourceId) => {
    console.log(`[Renderer Log] ${message} (${sourceId}:${line})`);
  });

  mainWindow.webContents.on("did-fail-load", (event, errorCode, errorDescription, validatedURL) => {
    console.error(`[Load Failed] ${errorCode}: ${errorDescription} on ${validatedURL}`);
  });

  // Enable native Windows OS-level hardware screen recording and screenshot blackout (WDA_MONITOR / DRM)
  // Desktop Window Manager (DWM) intercepts all screen capture APIs (OBS Studio, Windows Game Bar,
  // Snipping Tool, Zoom, Discord, GDI BitBlt, DXGI Desktop Duplication, Windows Graphics Capture)
  // and renders this window as a solid pitch-black rectangle in the recorded output,
  // while the physical user sitting at their monitor sees full HD video with complete clarity.
  const applyContentProtection = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        if (typeof mainWindow.setContentProtection === "function") {
          const shouldProtect = Boolean(isMeetingActiveInApp && !isHostInApp);
          mainWindow.setContentProtection(shouldProtect);
        }
      } catch (err) {
        console.warn("⚠️ Failed to set content protection:", err);
      }
    }
  };

  applyContentProtection();
  mainWindow.once("ready-to-show", applyContentProtection);
  mainWindow.on("show", applyContentProtection);
  mainWindow.on("focus", applyContentProtection);
  mainWindow.on("blur", () => {
    applyContentProtection();
  });
  mainWindow.on("restore", applyContentProtection);
  mainWindow.on("enter-full-screen", applyContentProtection);
  mainWindow.on("leave-full-screen", applyContentProtection);

  // Periodic heartbeat: guarantees content protection is maintained accurately
  const protectionInterval = setInterval(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      applyContentProtection();
    } else {
      clearInterval(protectionInterval);
    }
  }, 1000);

  // Intercept and neutralize hardware screenshot keys at OS window level
  mainWindow.webContents.on("before-input-event", (event, input) => {
    // RULE 1: If app is open outside of an active meeting, screenshots are 100% permitted!
    // RULE 2: If user is Host during meeting, screenshots are 100% permitted!
    if (!isMeetingActiveInApp || isHostInApp) {
      return;
    }

    const key = (input.key || "").toLowerCase();
    const code = (input.code || "").toLowerCase();

    // 1. Hardware PrintScreen key
    const isPrintScreen = key === "printscreen" || code === "printscreen" || key === "snapshot";
    // 2. Windows Snipping Tool (Win + Shift + S / Ctrl + Shift + S)
    const isSnippingTool = (input.control || input.meta) && input.shift && (key === "s" || code === "keys");
    // 3. Screen Recording Shortcuts (Win + Alt + R, Win + G, Alt + R, Ctrl + Alt + R)
    const isScreenRecording = (input.alt || input.control || input.meta) && (key === "r" || code === "keyr" || key === "g" || code === "keyg");
    // 4. Nvidia GeForce Experience Recording (Alt + F9, Alt + F10)
    const isNvidiaRecord = input.alt && (key === "f9" || key === "f10");
    // 5. Print dialog (Ctrl+P / Cmd+P)
    const isPrint = (input.control || input.meta) && (key === "p" || code === "keyp");
    // 6. Save page (Ctrl+S / Cmd+S)
    const isSave = (input.control || input.meta) && (key === "s" || code === "keys");
    // 7. Developer tools (F12, Ctrl+Shift+I/J/C)
    const isDevTools = key === "f12" || ((input.control || input.meta) && input.shift && ["i", "j", "c"].includes(key));

    if (isPrintScreen || isSnippingTool || isScreenRecording || isNvidiaRecord || isPrint || isSave || isDevTools) {
      event.preventDefault();
      console.warn("🛑 Blocked capture/recording keyboard shortcut in window:", input.key, input.code);
      triggerBurstClipboardPurge();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("os-screenshot-attempt", {
          source: (isScreenRecording || isNvidiaRecord) ? "recording" : "windows",
          platform: "windows",
          key: input.key
        });
      }
    }
  });

  // Automatically grant media permissions but strictly block screen display capture
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = ["media", "notifications", "fullscreen"];
    if (allowedPermissions.includes(permission)) {
      callback(true);
    } else {
      callback(false);
    }
  });

  // Netflix-Style: Strictly deny any display / screen capture requests
  if (typeof session.defaultSession.setDisplayMediaRequestHandler === "function") {
    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
      console.warn("🛑 Denied display media capture request (Netflix-style DRM active).");
      callback(null);
    });
  }

  // Active OS Clipboard Watchdog: Supercharged 50ms poll with deep bitmap & format inspection
  clipboardWatchdog = setInterval(() => {
    // Only inspect & purge if non-host participant in an active meeting!
    if (!isMeetingActiveInApp || isHostInApp) return;
    try {
      const formats = clipboard.availableFormats() || [];
      const hasImageFormat = formats.some((f) => {
        const lf = f.toLowerCase();
        return lf.includes("image") || lf.includes("bitmap") || lf.includes("dib") || f === "CF_DIB" || f === "CF_BITMAP";
      });
      const img = clipboard.readImage();
      const hasImg = img && !img.isEmpty();

      if (hasImageFormat || hasImg) {
        console.warn("🛑 Screen capture bitmap detected in Windows clipboard — Purging immediately!");
        purgeClipboard();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("os-screenshot-attempt", { source: "clipboard-image-detected", platform: "windows" });
        }
      }
    } catch {}
  }, 50);

  // Register OS global shortcuts to block screenshot & recording software keys
  const shortcutsToBlock = [
    "PrintScreen",
    "Alt+PrintScreen",
    "Control+PrintScreen",
    "Shift+PrintScreen",
    "CommandOrControl+Shift+S",
    "CommandOrControl+Alt+S",
    "CommandOrControl+Alt+R",
    "CommandOrControl+Shift+R",
    "CommandOrControl+G",
    "Alt+G",
    "CommandOrControl+P",
    "CommandOrControl+S",
    "Alt+F9",
    "Alt+F10",
    "F12",
    "Control+Shift+I",
    "Control+Shift+J",
    "Control+Shift+C"
  ];

  const registerGlobalShortcuts = () => {
    shortcutsToBlock.forEach((sc) => {
      try {
        if (!globalShortcut.isRegistered(sc)) {
          globalShortcut.register(sc, () => {
            // Outside meeting, or if user is Host: Allow shortcut!
            if (!isMeetingActiveInApp || isHostInApp) {
              return;
            }
            console.warn(`🛑 OS Global Shortcut Intercepted & Neutralized: ${sc}`);
            triggerBurstClipboardPurge();
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send("os-screenshot-attempt", {
                source: "global-shortcut",
                shortcut: sc,
                platform: "windows"
              });
            }
          });
        }
      } catch {}
    });
  };

  const unregisterGlobalShortcuts = () => {
    globalShortcut.unregisterAll();
  };

  mainWindow.once("ready-to-show", registerGlobalShortcuts);
  mainWindow.on("focus", registerGlobalShortcuts);
  mainWindow.on("blur", () => {
    applyContentProtection();
    if (!isMeetingActiveInApp || isHostInApp) return;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("os-screenshot-attempt", { source: "window-blur", platform: "windows" });
    }
  });

  // If local server is running on port 8000, load it; otherwise load built dist/index.html
  const localUrl = "http://localhost:8000";
  mainWindow.loadURL(localUrl).catch(() => {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  });

  mainWindow.on("closed", () => {
    if (clipboardWatchdog) {
      clearInterval(protectionInterval);
      clearInterval(clipboardWatchdog);
    }
    mainWindow = null;
  });
}

// IPC Handlers
ipcMain.on("meeting-state-change", (event, state) => {
  isMeetingActiveInApp = Boolean(state && state.inCall);
  isHostInApp = Boolean(state && state.isHost);
  if (mainWindow && !mainWindow.isDestroyed() && typeof mainWindow.setContentProtection === "function") {
    mainWindow.setContentProtection(Boolean(isMeetingActiveInApp && !isHostInApp));
  }
});

ipcMain.on("purge-clipboard", () => {
  if (!isMeetingActiveInApp || isHostInApp) return;
  triggerBurstClipboardPurge();
});

ipcMain.on("security-event-report", (event, eventData) => {
  console.warn("Security event reported from renderer:", eventData);
  triggerBurstClipboardPurge();
});

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  if (clipboardWatchdog) {
    clearInterval(clipboardWatchdog);
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
