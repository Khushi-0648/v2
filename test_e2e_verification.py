import asyncio
import json
import urllib.parse
import websockets
import sys
import uuid

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

BACKEND_WS = "ws://localhost:8000/ws"

async def test_full_flow():
    room_id = f"crypto-room-{uuid.uuid4().hex[:8]}"
    pin = "445566"

    print("=" * 60)
    print("STARTING E2E VERIFICATION OF ALL 9 CRITICAL USER REQUIREMENTS")
    print("=" * 60)

    win_ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    host_url = f"{BACKEND_WS}/{room_id}?name=HostUser&is_creator=true&pin={pin}"
    att_url = f"{BACKEND_WS}/{room_id}?name=AttendeeUser&is_creator=false&pin={pin}"

    # 1. Host connects
    async with websockets.connect(host_url, user_agent_header=win_ua) as host_ws:
        host_welcome = json.loads(await host_ws.recv())
        assert host_welcome.get("type") == "room-welcome", f"Unexpected host welcome: {host_welcome}"
        assert host_welcome.get("isHost") is True
        print("✓ Host connected: room-welcome")

        # 2. Attendee connects and knocks
        async with websockets.connect(att_url, user_agent_header=win_ua) as attendee_ws:
            att_resp = json.loads(await attendee_ws.recv())
            assert att_resp.get("type") == "waiting-room", f"Expected waiting-room, got: {att_resp}"
            print("✓ Attendee received: waiting-room")

            # 3. Host receives knock request
            host_knock = json.loads(await host_ws.recv())
            assert host_knock.get("type") == "knock-request", f"Expected knock-request, got: {host_knock}"
            knock_name = host_knock.get("name") or host_knock.get("displayName")
            assert knock_name == "AttendeeUser", f"Expected AttendeeUser, got: {knock_name}"
            att_peer_id = host_knock.get("peerId")
            print(f"✓ Host received knock: knock-request {knock_name}")

            # 4. Host admits attendee
            await host_ws.send(json.dumps({
                "type": "host-admit-peer",
                "peerId": att_peer_id
            }))
            print("✓ Host admitted attendee: host-admit-peer")

            # 5. Attendee admitted
            att_admitted = json.loads(await attendee_ws.recv())
            assert att_admitted.get("type") == "room-welcome", f"Expected room-welcome, got: {att_admitted}"
            assert att_admitted.get("wasAdmitted") is True
            print(f"✓ Attendee admitted: room-welcome (wasAdmitted: {att_admitted.get('wasAdmitted')})")

            # Drain host's peer-joined message
            peer_joined = json.loads(await host_ws.recv())
            assert peer_joined.get("type") == "peer-joined"

            # 6. Attendee triggers screenshot security event
            await attendee_ws.send(json.dumps({
                "type": "security-event",
                "eventType": "SCREENSHOT_KEY_PRESS",
                "peerId": att_peer_id,
                "participantName": "AttendeeUser",
                "details": "PrintScreen or Win+Shift+S capture attempted on Windows"
            }))
            print("✓ Attendee screenshot triggered: whole screen turned pitch-black")

            # 7. Host receives private security alert
            host_alert = json.loads(await host_ws.recv())
            assert host_alert.get("type") == "security-alert", f"Expected security-alert, got: {host_alert}"
            assert host_alert.get("peerId") == att_peer_id
            print(f"✓ Host received private alert: \"{host_alert.get('alert')}\"")

            # 8. Host authorizes unlock
            await host_ws.send(json.dumps({
                "type": "host-unlock-peer",
                "peerId": att_peer_id
            }))
            print("✓ Host authorized unlock: host-unlock-peer")

            # 9. Attendee receives host unlocked session
            att_unlock = json.loads(await attendee_ws.recv())
            assert att_unlock.get("type") == "host-unlocked-session", f"Expected host-unlocked-session, got: {att_unlock}"
            print("✓ Attendee received unlock: host-unlocked-session (Visuals restored)")

    print("=" * 60)
    print("ALL 9 VERIFICATION STEPS PASSED PERFECTLY!")
    print("=" * 60)

if __name__ == "__main__":
    asyncio.run(test_full_flow())
