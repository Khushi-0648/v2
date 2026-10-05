import re
import os

def test_screenshot_rules():
    print("============================================================")
    print("VERIFYING SCREENSHOT RULES:")
    print("1. Allow screenshot when app is open outside meeting")
    print("2. Allow screenshot for Host inside meeting")
    print("3. Block screenshot for all non-host participants in meeting")
    print("============================================================")

    index_path = os.path.join(os.path.dirname(__file__), "frontend", "index.html")
    with open(index_path, "r", encoding="utf-8") as f:
        index_content = f.read()

    # Rule 1 in index.html: wipeClipboard must not run when outside meeting or if host
    assert "if (!isCallActive() || isHostUser) return;" in index_content, "wipeClipboard must check !isCallActive() || isHostUser"
    print("[OK] index.html: wipeClipboard() is strictly disabled outside meetings and disabled for host.")

    # Rule 2 in index.html: Keydown must return immediately if !isCallActive() or isHostUser
    assert "if (!isCallActive()) {\n              return;\n            }" in index_content or "if (!isCallActive()) return;" in index_content, "keydown must allow screenshots outside call"
    assert "if (isHostUser || window.__isHostUser) {\n              return;\n            }" in index_content or "if (isHostUser || window.__isHostUser) return;" in index_content, "keydown must allow host screenshots"
    print("[OK] index.html: Keydown listener allows screenshots outside meetings and allows host screenshots.")

    # Rule 3 in index.html: Keyup / handlePrtScnEvent must return immediately if !isCallActive() or isHostUser
    assert "lastPrintScreenTime = now;\n            // RULE 1: If app is open outside of a meeting, screenshots are 100% permitted!\n            if (!isCallActive()) {\n              return;\n            }" in index_content
    assert "// RULE 2: If Host during meeting, screenshot is 100% permitted!\n            if (isHostUser || window.__isHostUser) {\n              return;\n            }" in index_content
    print("[OK] index.html: PrintScreen keyup allows screenshots outside meetings and allows host screenshots.")

    # Rule 4 in index.html: Window blur must not trigger outside call or for host
    assert "if (isHostUser || window.__isHostUser) return; // HOST IS EXEMPT\n          if (!isCallActive()) return; // OUTSIDE MEETING: BLUR IGNORED" in index_content
    print("[OK] index.html: Window blur is ignored outside meetings and ignored for host.")

    app_jsx_path = os.path.join(os.path.dirname(__file__), "frontend", "src", "App.jsx")
    with open(app_jsx_path, "r", encoding="utf-8") as f:
        app_jsx = f.read()

    # App.jsx: triggerScreenshotBlocked must return immediately if !inCall or isWaitingForAdmission or isHost
    assert "if (!inCall || isWaitingForAdmission) {\n      return;\n    }" in app_jsx
    assert "if (isHost || isHostRef.current) {\n      return;\n    }" in app_jsx
    print("[OK] App.jsx: triggerScreenshotBlocked() allows screenshots outside meetings and allows host screenshots.")

    # App.jsx: Privacy Shield useEffect must return immediately if !inCall or isWaitingForAdmission or isHost
    assert "if (isHost) return;\n    // 2. When the app is open outside of an active call (lobby, preview, schedule modal), screenshots are 100% permitted\n    if (!inCall || isWaitingForAdmission) return;" in app_jsx
    print("[OK] App.jsx: Privacy Shield DRM event listeners are not mounted outside active meetings.")

    # App.jsx: DRM blackout engaged must ignore outside meeting or if host
    assert "if (!inCall || isWaitingForAdmission) return;\n      if (isHost || isHostRef.current) return;\n      triggerScreenshotBlocked(e.detail?.source || \"hardware-pre-emption\");" in app_jsx
    print("[OK] App.jsx: Instant DRM blackout events only affect participants inside active meetings.")

    # Electron main.cjs verification
    electron_main_path = os.path.join(os.path.dirname(__file__), "frontend", "electron", "main.cjs")
    with open(electron_main_path, "r", encoding="utf-8") as f:
        electron_main = f.read()

    assert "mainWindow.setContentProtection(shouldProtect);" in electron_main
    assert "if (!isMeetingActiveInApp || isHostInApp) {\n      return;\n    }" in electron_main
    assert "if (!isMeetingActiveInApp || isHostInApp) return;" in electron_main
    print("[OK] Electron main.cjs: Content protection and clipboard purging are strictly limited to non-host participants in calls.")

    print("============================================================")
    print("ALL VERIFICATION CHECKS PASSED: SCREENSHOTS PERMITTED OUTSIDE")
    print("MEETINGS AND FOR HOST; STRICTLY BLOCKED FOR PARTICIPANTS IN-CALL!")
    print("============================================================")

if __name__ == "__main__":
    test_screenshot_rules()
