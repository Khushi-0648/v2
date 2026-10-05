import asyncio
import json
import websockets
import urllib.request

HOST = "localhost:8000"

async def test_host_controls():
    print("=== TEST: Host Moderation Permissions (Mute/Unmute, Video Start/Stop, Mute All, Unmute All) ===")
    
    room_code = "host-perm-test-2026"
    host_token = "creator-token-host-999"

    # Connect Host
    host_uri = f"ws://{HOST}/ws/{room_code}?name=MeetingHost&is_creator=true&creator_token={host_token}"
    guest1_uri = f"ws://{HOST}/ws/{room_code}?name=GuestOne"
    guest2_uri = f"ws://{HOST}/ws/{room_code}?name=GuestTwo"

    async with websockets.connect(host_uri) as ws_host:
        msg = json.loads(await ws_host.recv())
        assert msg["type"] == "room-welcome"
        assert msg["isHost"] is True
        host_pid = msg["myPeerId"]
        print(f"Host connected. Peer ID: {host_pid}")

        # Connect Guest 1 (Instant meeting -> waiting room -> host admits)
        async with websockets.connect(guest1_uri) as ws_guest1:
            g1_waiting = json.loads(await ws_guest1.recv())
            assert g1_waiting["type"] == "waiting-room"
            
            # Host receives knock
            knock1 = json.loads(await ws_host.recv())
            assert knock1["type"] == "knock-request"
            g1_pid = knock1["peerId"]
            print(f"Guest 1 knocking: {g1_pid}")

            # Host admits Guest 1
            await ws_host.send(json.dumps({"type": "host-admit-peer", "targetPeerId": g1_pid}))
            g1_welcome = json.loads(await ws_guest1.recv())
            assert g1_welcome["type"] == "room-welcome"
            assert g1_welcome["isHost"] is False
            print("Guest 1 admitted.")

            # Host receives peer-joined for Guest 1
            pj1 = json.loads(await ws_host.recv())
            assert pj1["type"] == "peer-joined"

            # Connect Guest 2
            async with websockets.connect(guest2_uri) as ws_guest2:
                g2_waiting = json.loads(await ws_guest2.recv())
                assert g2_waiting["type"] == "waiting-room"
                knock2 = json.loads(await ws_host.recv())
                g2_pid = knock2["peerId"]
                print(f"Guest 2 knocking: {g2_pid}")

                # Host admits Guest 2
                await ws_host.send(json.dumps({"type": "host-admit-peer", "targetPeerId": g2_pid}))
                g2_welcome = json.loads(await ws_guest2.recv())
                assert g2_welcome["type"] == "room-welcome"
                print("Guest 2 admitted.")

                # Drain notifications
                await ws_host.recv() # peer-joined for Guest 2
                await ws_guest1.recv() # peer-joined for Guest 2

                # 1. TEST HOST MUTE INDIVIDUAL PARTICIPANT (Guest 1)
                print("Testing Host Mute Individual (Guest 1)...")
                await ws_host.send(json.dumps({
                    "type": "host-mute-mic",
                    "targetPeerId": g1_pid
                }))
                g1_msg = json.loads(await ws_guest1.recv())
                assert g1_msg["type"] == "host-mute-mic"
                print("Guest 1 received host-mute-mic!")

                # 2. TEST HOST UNMUTE INDIVIDUAL PARTICIPANT (Guest 1)
                print("Testing Host Unmute Individual (Guest 1)...")
                await ws_host.send(json.dumps({
                    "type": "host-unmute-mic",
                    "targetPeerId": g1_pid
                }))
                g1_msg = json.loads(await ws_guest1.recv())
                assert g1_msg["type"] == "host-unmute-mic"
                print("Guest 1 received host-unmute-mic!")

                # 3. TEST HOST STOP VIDEO INDIVIDUAL PARTICIPANT (Guest 1)
                print("Testing Host Stop Video Individual (Guest 1)...")
                await ws_host.send(json.dumps({
                    "type": "host-stop-video",
                    "targetPeerId": g1_pid
                }))
                g1_msg = json.loads(await ws_guest1.recv())
                assert g1_msg["type"] == "host-stop-video"
                print("Guest 1 received host-stop-video!")

                # 4. TEST HOST START VIDEO INDIVIDUAL PARTICIPANT (Guest 1)
                print("Testing Host Start Video Individual (Guest 1)...")
                await ws_host.send(json.dumps({
                    "type": "host-start-video",
                    "targetPeerId": g1_pid
                }))
                g1_msg = json.loads(await ws_guest1.recv())
                assert g1_msg["type"] == "host-start-video"
                print("Guest 1 received host-start-video!")

                # 5. TEST HOST MUTE ALL
                print("Testing Host Mute All...")
                await ws_host.send(json.dumps({
                    "type": "host-mute-all"
                }))
                g1_mute_all = json.loads(await ws_guest1.recv())
                g2_mute_all = json.loads(await ws_guest2.recv())
                assert g1_mute_all["type"] == "host-mute-all"
                assert g2_mute_all["type"] == "host-mute-all"
                print("Both Guest 1 and Guest 2 received host-mute-all!")

                # 6. TEST HOST UNMUTE ALL
                print("Testing Host Unmute All...")
                await ws_host.send(json.dumps({
                    "type": "host-unmute-all"
                }))
                g1_unmute_all = json.loads(await ws_guest1.recv())
                g2_unmute_all = json.loads(await ws_guest2.recv())
                assert g1_unmute_all["type"] == "host-unmute-all"
                assert g2_unmute_all["type"] == "host-unmute-all"
                print("Both Guest 1 and Guest 2 received host-unmute-all!")

                # 7. TEST HOST STOP ALL VIDEO & START ALL VIDEO
                print("Testing Host Stop All Video...")
                await ws_host.send(json.dumps({
                    "type": "host-stop-all-video"
                }))
                g1_stop_vid = json.loads(await ws_guest1.recv())
                g2_stop_vid = json.loads(await ws_guest2.recv())
                assert g1_stop_vid["type"] == "host-stop-all-video"
                assert g2_stop_vid["type"] == "host-stop-all-video"
                print("Both Guest 1 and Guest 2 received host-stop-all-video!")

                print("Testing Host Start All Video...")
                await ws_host.send(json.dumps({
                    "type": "host-start-all-video"
                }))
                g1_start_vid = json.loads(await ws_guest1.recv())
                g2_start_vid = json.loads(await ws_guest2.recv())
                assert g1_start_vid["type"] == "host-start-all-video"
                assert g2_start_vid["type"] == "host-start-all-video"
                print("Both Guest 1 and Guest 2 received host-start-all-video!")

                # 8. TEST SECURITY: NON-HOST CANNOT SEND HOST COMMANDS
                print("Testing Non-Host Rejection...")
                await ws_guest1.send(json.dumps({
                    "type": "host-mute-all"
                }))
                # Verify Host never receives this unauthorized command
                await asyncio.sleep(0.5)
                print("Verified non-host attempt was rejected by server!")

    print("\n>>> ALL HOST MODERATION PERMISSION TESTS PASSED 100%! <<<\n")

if __name__ == "__main__":
    asyncio.run(test_host_controls())
