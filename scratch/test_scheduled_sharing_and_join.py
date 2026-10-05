import requests
import json
import re

BASE_URL = "http://127.0.0.1:8000"

def test_scheduled_meeting_and_extraction():
    print("--- 1. Testing Scheduled Meeting API & Mandatory Passcode ---")
    # Health check
    h = requests.get(f"{BASE_URL}/health")
    assert h.status_code == 200
    print("Health check OK:", h.json())

    # Schedule a meeting with mandatory 8-char passcode
    meeting_payload = {
        "title": "Executive Board Sync",
        "code": "exec_sync_99a8b7c6",
        "pin": "K9M2P4X8",
        "scheduledFor": "Tomorrow 10:00 AM",
        "hostName": "Satya"
    }
    r = requests.post(f"{BASE_URL}/api/schedule-meeting", json=meeting_payload)
    assert r.status_code == 200, f"Failed to schedule: {r.text}"
    print("Schedule API Response:", r.json())

    # Check room status
    status_resp = requests.get(f"{BASE_URL}/api/room-status/exec_sync_99a8b7c6")
    assert status_resp.status_code == 200
    status_data = status_resp.json()
    print("Room status:", status_data)
    assert status_data["requiresPin"] is True, "Scheduled room should require PIN"

    # Simulate Invitation Message Generation (Matching frontend format)
    origin = "https://beautiful-took-desktops-kidney.trycloudflare.com"
    code = meeting_payload["code"]
    pin = meeting_payload["pin"]
    title = meeting_payload["title"]
    time_str = meeting_payload["scheduledFor"]

    invite_url = f"{origin}/#code={code}&pin={pin}"
    invitation_message = f"""📅 V2 Meet HD — Scheduled Meeting Invitation
📌 Topic: {title}
🕒 Time: {time_str}

🔗 Direct Meeting Link (Includes Passcode):
{invite_url}

🔑 Meeting Code: {code}
🔒 Passcode: {pin} (Mandatory to enter)

🛡️ Zero-Knowledge Hardware AES-256-GCM End-to-End Encrypted"""

    print("\n--- 2. Formatted Invitation Message (Link + Passcode Shared Together) ---")
    print(invitation_message)

    # Test regex patterns from frontend extractCodeAndPinFromInput
    def extract_code_and_pin(raw):
        text = (raw or "").strip()
        extracted_pin = ""
        extracted_code = ""

        # Pin extraction
        pin_q = re.search(r"[?&#]pin=([a-zA-Z0-9]{8})", text, re.IGNORECASE)
        pin_t = re.search(r"(?:passcode|pin|security code)[:\s*]+([a-zA-Z0-9]{8})", text, re.IGNORECASE)
        if pin_q:
            extracted_pin = pin_q.group(1).upper()
        elif pin_t:
            extracted_pin = pin_t.group(1).upper()

        # Code extraction
        code_q = re.search(r"[?&#]code=([a-zA-Z0-9_-]+)", text, re.IGNORECASE)
        code_t = re.search(r"(?:meeting code|code)[:\s*]+([a-zA-Z0-9_-]+)", text, re.IGNORECASE)
        if code_q:
            extracted_code = code_q.group(1)
        elif code_t:
            extracted_code = code_t.group(1)
        elif not text.count("\n") and not text.count(" "):
            extracted_code = text

        return extracted_code, extracted_pin

    print("\n--- 3. Testing Extraction from Various Formats ---")
    # Test 3a: Full invitation message
    c, p = extract_code_and_pin(invitation_message)
    print("From Full Invitation -> Code:", c, "| Passcode:", p)
    assert c == code, f"Expected {code}, got {c}"
    assert p == pin, f"Expected {pin}, got {p}"

    # Test 3b: Direct Link with hash
    c, p = extract_code_and_pin(invite_url)
    print("From Direct Hash URL -> Code:", c, "| Passcode:", p)
    assert c == code
    assert p == pin

    # Test 3c: Direct Link with query
    query_url = f"{origin}/?code={code}&pin={pin}"
    c, p = extract_code_and_pin(query_url)
    print("From Direct Query URL -> Code:", c, "| Passcode:", p)
    assert c == code
    assert p == pin

    # Test 3d: Plain code
    c, p = extract_code_and_pin(code)
    print("From Plain Code -> Code:", c, "| Passcode:", p)
    assert c == code
    assert p == ""

    print("\n✅ All scheduled meeting invitation and extraction checks PASSED 100%!")

if __name__ == "__main__":
    test_scheduled_meeting_and_extraction()
