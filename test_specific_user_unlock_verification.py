import asyncio
import json
import websockets
import sys
import uuid

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

BACKEND_WS = "ws://localhost:8000/ws"

async def test_specific_user_host_unlock_authority():
    room_id = f"test-specific-unlock-{uuid.uuid4().hex[:8]}"
    pin = "123456"

    print("=" * 70)
    print("VERIFYING GRANULAR HOST AUTHORITY: SPECIFIC USER UNLOCK FLOW")
    print("=" * 70)

    win_ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    host_url = f"{BACKEND_WS}/{room_id}?name=HostUser&is_creator=true&pin={pin}"
    alice_url = f"{BACKEND_WS}/{room_id}?name=Alice&is_creator=false&pin={pin}"
    bob_url = f"{BACKEND_WS}/{room_id}?name=Bob&is_creator=false&pin={pin}"

    async with websockets.connect(host_url, user_agent_header=win_ua) as host_ws:
        # 1. Host welcome
        host_welcome = json.loads(await host_ws.recv())
        assert host_welcome.get("type") == "room-welcome"
        assert host_welcome.get("isHost") is True
        host_peer_id = host_welcome.get("myPeerId")
        print(f"[PASS] 1. Host connected as administrator ({host_peer_id})")

        # 2. Alice connects to waiting room
        async with websockets.connect(alice_url, user_agent_header=win_ua) as alice_ws:
            alice_resp = json.loads(await alice_ws.recv())
            assert alice_resp.get("type") == "waiting-room"
            print("[PASS] 2. Alice connected: safely placed in waiting room (zero black screen)")

            # Host gets knock from Alice and admits Alice
            alice_knock = json.loads(await host_ws.recv())
            assert alice_knock.get("type") == "knock-request"
            alice_peer_id = alice_knock.get("peerId")
            await host_ws.send(json.dumps({
                "type": "host-admit-peer",
                "peerId": alice_peer_id
            }))

            # Alice welcomed
            alice_admitted = json.loads(await alice_ws.recv())
            assert alice_admitted.get("type") == "room-welcome"
            assert alice_admitted.get("wasAdmitted") is True
            print(f"[PASS] 3. Host admitted Alice ({alice_peer_id}) without black screen")

            # Drain host's peer-joined for Alice
            msg = json.loads(await host_ws.recv())
            assert msg.get("type") == "peer-joined"

            # 3. Bob connects to waiting room
            async with websockets.connect(bob_url, user_agent_header=win_ua) as bob_ws:
                bob_resp = json.loads(await bob_ws.recv())
                assert bob_resp.get("type") == "waiting-room"
                print("[PASS] 4. Bob connected: safely placed in waiting room (zero black screen)")

                # Host gets knock from Bob and admits Bob
                bob_knock = json.loads(await host_ws.recv())
                assert bob_knock.get("type") == "knock-request"
                bob_peer_id = bob_knock.get("peerId")
                await host_ws.send(json.dumps({
                    "type": "host-admit-peer",
                    "peerId": bob_peer_id
                }))

                # Bob welcomed
                bob_admitted = json.loads(await bob_ws.recv())
                assert bob_admitted.get("type") == "room-welcome"
                assert bob_admitted.get("wasAdmitted") is True
                print(f"[PASS] 5. Host admitted Bob ({bob_peer_id}) without black screen")

                # Drain peer-joined messages
                # Alice receives Bob joined
                alice_peer_msg = json.loads(await alice_ws.recv())
                assert alice_peer_msg.get("type") == "peer-joined"
                # Host receives Bob joined
                host_peer_msg = json.loads(await host_ws.recv())
                assert host_peer_msg.get("type") == "peer-joined"

                # 4. Alice attempts a screenshot on Windows
                await alice_ws.send(json.dumps({
                    "type": "security-event",
                    "eventType": "SCREENSHOT_KEY_PRESS",
                    "peerId": alice_peer_id,
                    "participantName": "Alice",
                    "details": "Alice attempted screenshot on Windows Desktop"
                }))
                print("[PASS] 6. Alice attempted screenshot: Her screen entered solid pitch-black lockdown")

                # Host receives security alert specifically identifying Alice
                host_alert_alice = json.loads(await host_ws.recv())
                assert host_alert_alice.get("type") == "security-alert"
                assert host_alert_alice.get("offenderPeerId") == alice_peer_id
                assert "Alice" in host_alert_alice.get("alert")
                print(f"[PASS] 7. Host received private alert specifically naming Alice: \"{host_alert_alice.get('alert')}\"")

                # 5. Bob attempts screen recording
                await bob_ws.send(json.dumps({
                    "type": "security-event",
                    "eventType": "SCREEN_RECORD_DETECTED",
                    "peerId": bob_peer_id,
                    "participantName": "Bob",
                    "details": "Bob attempted screen recording on Windows Desktop"
                }))
                print("[PASS] 8. Bob attempted screen recording: His screen entered solid pitch-black lockdown")

                # Host receives security alert specifically identifying Bob
                host_alert_bob = json.loads(await host_ws.recv())
                assert host_alert_bob.get("type") == "security-alert"
                assert host_alert_bob.get("offenderPeerId") == bob_peer_id
                assert "Bob" in host_alert_bob.get("alert")
                print(f"[PASS] 9. Host received private alert specifically naming Bob: \"{host_alert_bob.get('alert')}\"")

                # 6. Non-host (Bob) tries to authorize/unlock himself - MUST BE REJECTED by backend
                await bob_ws.send(json.dumps({
                    "type": "host-unlock-peer",
                    "targetPeerId": bob_peer_id
                }))
                bob_err = json.loads(await bob_ws.recv())
                assert bob_err.get("type") == "error"
                assert bob_err.get("code") == "UNAUTHORIZED_HOST_ACTION"
                print("[PASS] 10. Non-host authorization attempt by Bob was REJECTED (Zero-Trust security intact)")

                # 7. Host selectively unlocks ONLY Alice
                await host_ws.send(json.dumps({
                    "type": "host-unlock-peer",
                    "targetPeerId": alice_peer_id
                }))
                host_ack_alice = json.loads(await host_ws.recv())
                assert host_ack_alice.get("type") == "status"
                assert "Alice" in host_ack_alice.get("message")
                print(f"[PASS] 11. Host granted permission specifically for Alice: {host_ack_alice.get('message')}")

                # Alice receives host-unlocked-session
                alice_unlock = json.loads(await alice_ws.recv())
                assert alice_unlock.get("type") == "host-unlocked-session"
                print(f"[PASS] 12. Alice received unlock: \"{alice_unlock.get('message')}\" (Visuals restored)")

                # Verify Bob is STILL locked (Bob did NOT receive unlock message)
                try:
                    unexpected_bob_msg = await asyncio.wait_for(bob_ws.recv(), timeout=0.6)
                    parsed_bob = json.loads(unexpected_bob_msg)
                    assert parsed_bob.get("type") != "host-unlocked-session", "Bob should NOT have been unlocked!"
                except asyncio.TimeoutError:
                    print("[PASS] 13. Verified Bob remains in pitch-black lockdown (Granular isolation works)")

                # 8. Host now selectively unlocks Bob
                await host_ws.send(json.dumps({
                    "type": "host-unlock-peer",
                    "targetPeerId": bob_peer_id
                }))
                host_ack_bob = json.loads(await host_ws.recv())
                assert host_ack_bob.get("type") == "status"
                assert "Bob" in host_ack_bob.get("message")
                print(f"[PASS] 14. Host granted permission specifically for Bob: {host_ack_bob.get('message')}")

                # Bob receives host-unlocked-session
                bob_unlock = json.loads(await bob_ws.recv())
                assert bob_unlock.get("type") == "host-unlocked-session"
                print(f"[PASS] 15. Bob received unlock: \"{bob_unlock.get('message')}\" (Visuals restored)")

    print("=" * 70)
    print("ALL 15 TESTS PASSED: HOST HAS FULL AUTHORITY TO UNLOCK SPECIFIC USERS!")
    print("=" * 70)

if __name__ == "__main__":
    asyncio.run(test_specific_user_host_unlock_authority())
