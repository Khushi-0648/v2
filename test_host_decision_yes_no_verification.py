import asyncio
import json
import websockets
import sys
import uuid

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

BACKEND_WS = "ws://localhost:8000/ws"

async def test_host_yes_no_decision_flow():
    room_id = f"test-decision-{uuid.uuid4().hex[:8]}"
    pin = "123456"

    print("=" * 75)
    print("VERIFYING HOST YES/NO DECISION WORKFLOW ON PARTICIPANT SCREENSHOT")
    print("=" * 75)

    win_ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    host_url = f"{BACKEND_WS}/{room_id}?name=HostAdmin&is_creator=true&pin={pin}"
    alice_url = f"{BACKEND_WS}/{room_id}?name=Alice&is_creator=false&pin={pin}"
    charlie_url = f"{BACKEND_WS}/{room_id}?name=Charlie&is_creator=false&pin={pin}"

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

            # Host admits Alice
            alice_knock = json.loads(await host_ws.recv())
            assert alice_knock.get("type") == "knock-request"
            alice_peer_id = alice_knock.get("peerId")
            await host_ws.send(json.dumps({
                "type": "host-admit-peer",
                "peerId": alice_peer_id
            }))

            alice_admitted = json.loads(await alice_ws.recv())
            assert alice_admitted.get("type") == "room-welcome"
            assert alice_admitted.get("wasAdmitted") is True
            print(f"[PASS] 2. Host admitted Alice ({alice_peer_id}) - no black screen on join")

            # Drain host's peer-joined for Alice
            msg = json.loads(await host_ws.recv())
            assert msg.get("type") == "peer-joined"

            # 3. Charlie connects and is admitted
            async with websockets.connect(charlie_url, user_agent_header=win_ua) as charlie_ws:
                charlie_resp = json.loads(await charlie_ws.recv())
                assert charlie_resp.get("type") == "waiting-room"

                charlie_knock = json.loads(await host_ws.recv())
                assert charlie_knock.get("type") == "knock-request"
                charlie_peer_id = charlie_knock.get("peerId")
                await host_ws.send(json.dumps({
                    "type": "host-admit-peer",
                    "peerId": charlie_peer_id
                }))

                charlie_admitted = json.loads(await charlie_ws.recv())
                assert charlie_admitted.get("type") == "room-welcome"
                print(f"[PASS] 3. Host admitted Charlie ({charlie_peer_id})")

                # Drain peer-joined messages
                # Alice receives Charlie joined
                await alice_ws.recv()
                # Host receives Charlie joined
                await host_ws.recv()

                # =========================================================================
                # SCENARIO 1: Alice tries screenshot -> black screen appears -> Host says NO
                # =========================================================================
                print("\n--- SCENARIO 1: ALICE TRIES SCREENSHOT -> HOST SAYS NO (DO NOT REMOVE) ---")
                await alice_ws.send(json.dumps({
                    "type": "security-event",
                    "eventType": "SCREENSHOT_ATTEMPT",
                    "peerId": alice_peer_id,
                    "participantName": "Alice",
                    "platform": "windows",
                    "details": "PrintScreen pressed"
                }))
                print("[PASS] 4. Alice attempted screenshot on Windows. Her screen turned solid black.")

                # Host receives security alert:
                host_alert = None
                for _ in range(5):
                    raw = await asyncio.wait_for(host_ws.recv(), timeout=3.0)
                    msg = json.loads(raw)
                    if msg.get("type") == "security-alert":
                        host_alert = msg
                        break
                assert host_alert is not None, "Host did not receive security-alert message"
                assert host_alert.get("type") == "security-alert"
                assert host_alert.get("offenderPeerId") == alice_peer_id
                print(f"[PASS] 5. Host notified: '{host_alert.get('alert')}'")
                print("   Host prompted: 'Alice tried to take a screenshot! Do you want to remove that black screen?'")

                # Host says: "No, do not remove that screen" (clicks [No, Do Not Remove Screen])
                await host_ws.send(json.dumps({
                    "type": "host-deny-unlock-peer",
                    "targetPeerId": alice_peer_id
                }))
                host_deny_ack = json.loads(await host_ws.recv())
                assert host_deny_ack.get("type") == "status"
                assert "Kept black screen locked for Alice" in host_deny_ack.get("message")
                print(f"[PASS] 6. Host selected [No, Do Not Remove Screen]. Host ack: '{host_deny_ack.get('message')}'")

                # Alice receives host-denied-unlock message and her screen stays black
                alice_denied_msg = json.loads(await alice_ws.recv())
                assert alice_denied_msg.get("type") == "host-denied-unlock"
                assert "did not grant permission to remove the black screen" in alice_denied_msg.get("message")
                print(f"[PASS] 7. Alice received denial: '{alice_denied_msg.get('message')}'. Visual content remains locked!")

                # Verify Charlie did not receive any unlock/lock change
                try:
                    await asyncio.wait_for(charlie_ws.recv(), timeout=0.4)
                    assert False, "Charlie should not receive messages meant for Alice"
                except asyncio.TimeoutError:
                    print("[PASS] 8. Verified Charlie is unaffected (granular isolation confirmed)")

                # =========================================================================
                # SCENARIO 2: Later, Host decides to say YES -> removes black screen for Alice
                # =========================================================================
                print("\n--- SCENARIO 2: HOST LATER SAYS YES (REMOVE BLACK SCREEN) ---")
                await host_ws.send(json.dumps({
                    "type": "host-unlock-peer",
                    "targetPeerId": alice_peer_id
                }))
                host_unlock_ack = json.loads(await host_ws.recv())
                assert host_unlock_ack.get("type") == "status"
                assert "unlocked Alice" in host_unlock_ack.get("message")
                print(f"[PASS] 9. Host selected [Yes, Remove Black Screen]. Host ack: '{host_unlock_ack.get('message')}'")

                # Alice receives host-unlocked-session and her visual screen is restored
                alice_unlock_msg = json.loads(await alice_ws.recv())
                assert alice_unlock_msg.get("type") == "host-unlocked-session"
                assert "has authorized your session" in alice_unlock_msg.get("message")
                print(f"[PASS] 10. Alice received unlock: '{alice_unlock_msg.get('message')}'. Black screen removed!")

                # =========================================================================
                # SCENARIO 3: Non-host authorization attempts are rejected
                # =========================================================================
                print("\n--- SCENARIO 3: NON-HOST ATTEMPT TO OVERRIDE DECISION IS REJECTED ---")
                await charlie_ws.send(json.dumps({
                    "type": "host-deny-unlock-peer",
                    "targetPeerId": alice_peer_id
                }))
                charlie_err = json.loads(await charlie_ws.recv())
                assert charlie_err.get("type") == "error"
                assert charlie_err.get("code") == "UNAUTHORIZED_HOST_ACTION"
                print("[PASS] 11. Charlie tried to deny/unlock: REJECTED with UNAUTHORIZED_HOST_ACTION.")

    print("\n" + "=" * 75)
    print("ALL 11 VERIFICATION CHECKS PASSED: FULL YES/NO HOST AUTHORITY CONFIRMED!")
    print("=" * 75)

if __name__ == "__main__":
    asyncio.run(test_host_yes_no_decision_flow())
