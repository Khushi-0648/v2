const { app, BrowserWindow } = require("electron");
const { execFileSync } = require("child_process");
const path = require("path");

app.whenReady().then(() => {
  const win = new BrowserWindow({ show: false, width: 400, height: 300 });
  win.setContentProtection(true);
  const handle = win.getNativeWindowHandle();
  const hwnd = handle.readBigInt64LE(0).toString();
  console.log("HWND:", hwnd);
  try {
    const out = execFileSync(path.join(__dirname, "electron/SetAffinity.exe"), [hwnd, "0"], { encoding: "utf8" });
    console.log("Read affinity output:", out.trim());
  } catch (err) {
    console.log("Exec error:", err.stdout || err.message);
  }
  app.quit();
});
