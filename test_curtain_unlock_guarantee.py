import urllib.request
import json

def test_unlock():
    base_url = "http://127.0.0.1:8000"
    
    win_headers = {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    
    # 1. Post a security event
    req_data = json.dumps({
        "eventType": "SCREENSHOT_ATTEMPT",
        "platform": "windows",
        "roomCode": "test-curtain-room",
        "participantName": "ParticipantBob",
        "peerId": "bob123",
        "details": {"source": "printscreen"}
    }).encode("utf-8")
    req = urllib.request.Request(f"{base_url}/api/security-event", data=req_data, headers=win_headers)
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode("utf-8"))
        print("1. Security Event recorded:", data)
        assert resp.status == 200

    # 2. Check room security status
    req = urllib.request.Request(f"{base_url}/api/room-security-status/test-curtain-room", headers={"User-Agent": win_headers["User-Agent"]})
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode("utf-8"))
        print("2. Status before unlock:", data)
        assert data["hasAlert"] is True
        assert data["lockedCount"] >= 1

    # 3. Host calls unlock
    req_data = json.dumps({
        "roomCode": "test-curtain-room",
        "targetPeerId": "bob123",
        "hostName": "HostAlice"
    }).encode("utf-8")
    req = urllib.request.Request(f"{base_url}/api/host-unlock-peer", data=req_data, headers=win_headers)
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode("utf-8"))
        print("3. Host Unlock called:", data)
        assert resp.status == 200

    # 4. Check room security status after unlock
    req = urllib.request.Request(f"{base_url}/api/room-security-status/test-curtain-room", headers={"User-Agent": win_headers["User-Agent"]})
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode("utf-8"))
        print("4. Status after unlock:", data)
        assert data["hasAlert"] is False
        assert data["lockedCount"] == 0

    print("\n[SUCCESS] Host unlock immediately cleared room lock and alert status! Watchdog clears curtain on participant.")

if __name__ == "__main__":
    test_unlock()
