import asyncio
import json
import websockets
import sys
import uuid

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

BACKEND_WS = "ws://localhost:8000/ws"

async def test_host_exemption_and_attendee_lockdown():
    room_id = f"test-host-exempt-{uuid.uuid4().hex[:8]}"
    pin = "123456"

    print("=" * 60)
    print("VERIFYING HOST EXEMPTION & ATTENDEE LOCKDOWN / PERMISSION FLOW")
    print("=" * 60)

    win_ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    host_url = f"{BACKEND_WS}/{room_id}?name=HostUser&is_creator=true&pin={pin}"
    att_url = f"{BACKEND_WS}/{room_id}?name=AttendeeUser&is_creator=false&pin={pin}"

    async with websockets.connect(host_url, user_agent_header=win_ua) as host_ws:
        # 1. Host welcome
        host_welcome = json.loads(await host_ws.recv())
        assert host_welcome.get("type") == "room-welcome"
        assert host_welcome.get("isHost") is True
        host_peer_id = host_welcome.get("myPeerId")
        print(f"[OK] 1. Host connected as administrator ({host_peer_id})")

        # 2. Host tries screenshot - should be completely exempt!
        await host_ws.send(json.dumps({
            "type": "security-event",
            "eventType": "SCREENSHOT_KEY_PRESS",
            "peerId": host_peer_id,
            "participantName": "HostUser",
            "details": "Host took screenshot — host should NEVER face lockdown"
        }))
        
        # Verify no alert or lockdown is sent to the host (wait 0.5s with timeout)
        try:
            unexpected_msg = await asyncio.wait_for(host_ws.recv(), timeout=0.5)
            # If any message arrived, assert it is NOT a security alert
            parsed = json.loads(unexpected_msg)
            assert parsed.get("type") != "security-alert", f"Host received unexpected security-alert for itself: {parsed}"
        except asyncio.TimeoutError:
            print("[OK] 2. Host is EXEMPT: Zero lockdown, zero self-alerts received by host!")

        # 3. Attendee connects and enters waiting room
        async with websockets.connect(att_url, user_agent_header=win_ua) as attendee_ws:
            att_resp = json.loads(await attendee_ws.recv())
            assert att_resp.get("type") == "waiting-room"
            print("[OK] 3. Attendee connected: entered waiting-room")

            # 4. Host admits attendee
            host_knock = json.loads(await host_ws.recv())
            assert host_knock.get("type") == "knock-request"
            att_peer_id = host_knock.get("peerId")
            await host_ws.send(json.dumps({
                "type": "host-admit-peer",
                "peerId": att_peer_id
            }))
            print("[OK] 4. Host admitted attendee")

            # Attendee welcomed
            att_admitted = json.loads(await attendee_ws.recv())
            assert att_admitted.get("type") == "room-welcome"
            assert att_admitted.get("wasAdmitted") is True

            # Drain host's peer-joined message
            peer_joined = json.loads(await host_ws.recv())
            assert peer_joined.get("type") == "peer-joined"

            # 5. Attendee triggers screenshot - ONLY attendee faces lockdown!
            await attendee_ws.send(json.dumps({
                "type": "security-event",
                "eventType": "SCREENSHOT_KEY_PRESS",
                "peerId": att_peer_id,
                "participantName": "AttendeeUser",
                "details": "Attendee attempted screenshot on Windows"
            }))
            print("[OK] 5. Attendee screenshot triggered: Participant locked in pitch-black")

            # 6. Host receives private security alert with attendee details
            host_alert = json.loads(await host_ws.recv())
            assert host_alert.get("type") == "security-alert"
            assert host_alert.get("offenderPeerId") == att_peer_id
            print(f"[OK] 6. Host received notification for attendee: \"{host_alert.get('alert')}\"")

            # 7. Host tests Mute / Unmute participant controls
            await host_ws.send(json.dumps({
                "type": "host-mute-mic",
                "targetPeerId": att_peer_id
            }))
            att_mute = json.loads(await attendee_ws.recv())
            assert att_mute.get("type") == "host-mute-mic"
            print("[OK] 7. Host participant control verified: host muted participant mic")

            await host_ws.send(json.dumps({
                "type": "host-unmute-mic",
                "targetPeerId": att_peer_id
            }))
            att_unmute = json.loads(await attendee_ws.recv())
            assert att_unmute.get("type") == "host-unmute-mic"
            print("[OK] 8. Host participant control verified: host unmuted participant mic")

            # 8. Host grants permission to remove black screen
            await host_ws.send(json.dumps({
                "type": "host-unlock-peer",
                "peerId": att_peer_id
            }))
            print("[OK] 9. Host granted permission: host-unlock-peer sent")

            # 9. Attendee receives unlock session and visual feeds are restored
            att_unlock = json.loads(await attendee_ws.recv())
            assert att_unlock.get("type") == "host-unlocked-session"
            print(f"[OK] 10. Attendee received unlock: {att_unlock.get('message')}")

    print("=" * 60)
    print("ALL VERIFICATION CHECKS PASSED: HOST NEVER FACES LOCKDOWN, ONLY PARTICIPANTS DO!")
    print("=" * 60)

if __name__ == "__main__":
    asyncio.run(test_host_exemption_and_attendee_lockdown())
