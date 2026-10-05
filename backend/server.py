import asyncio
import json
import logging
import os
import time
import uuid
import hashlib
import hmac
import re
import secrets
from contextlib import asynccontextmanager
from typing import Dict, Any, List, Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, InvalidHashError

# Industrial-grade Argon2id Password & Secret Hasher
ph = PasswordHasher()

def hash_secret_argon2(secret: str) -> str:
    """Hashes passwords, pins, and secrets chosen by humans using Argon2id."""
    return ph.hash(secret.strip())

def verify_secret_argon2(hash_or_plain: str, candidate: str) -> bool:
    """Verifies candidate secret against Argon2id hash with safe fallback."""
    if not hash_or_plain or not candidate:
        return False
    cand_clean = candidate.strip()
    if hash_or_plain.startswith("$argon2"):
        try:
            return ph.verify(hash_or_plain, cand_clean)
        except (VerifyMismatchError, InvalidHashError):
            return False
    # Legacy fallback for backward compatibility
    return hmac.compare_digest(hash_or_plain.upper(), cand_clean.upper())

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("V2-Signaling")

@asynccontextmanager
async def lifespan(app: FastAPI):
    worker_task = asyncio.create_task(periodic_maintenance_worker())
    logger.info("Started continuous security & room lifecycle maintenance daemon.")
    yield
    worker_task.cancel()
    try:
        await worker_task
    except asyncio.CancelledError:
        pass

app = FastAPI(title="V2 Multi-Party E2EE Signaling Server", version="3.0.0", lifespan=lifespan)

# Security Headers & OS Policy Middleware
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    # Enforce Windows OS policy on meeting API operations
    if request.url.path.startswith("/api/"):
        ua = request.headers.get("user-agent", "")
        if not is_windows_user_agent(ua):
            return JSONResponse(
                status_code=403,
                content={
                    "error": "WINDOWS_OS_REQUIRED",
                    "message": "Access Denied: V2 Meet HD is strictly restricted to Windows OS workstations."
                }
            )
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(self), microphone=(self), display-capture=(self), geolocation=()"
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    return response

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Room structure: room_id -> {"peers": { peer_id: {"ws": WebSocket, "name": str} }, "created_at": float}
ROOMS: Dict[str, Dict[str, Any]] = {}
MAX_PARTICIPANTS_PER_ROOM = 50

# =====================================================================
# Ephemeral Security Store: Invalidate Expired Rooms, Links & Tokens
# Prohibits permanent meeting tokens, perpetual links, and session re-entry
# =====================================================================
EXPIRED_ROOMS: Dict[str, Dict[str, Any]] = {}
DEFAULT_MEETING_TTL_SECONDS = 7200.0   # 2 hours maximum lifetime for ephemeral meeting sessions
SCHEDULED_MAX_LIFETIME_SECONDS = 86400.0  # 24 hours maximum lifetime for scheduled meetings

# Scheduled meetings store: meeting_code -> {title, code, scheduled_for, created_at, host_name, expiresAt}
SCHEDULED_MEETINGS: Dict[str, Dict[str, Any]] = {}

# Opaque Join Token Registry (completely removes room ID and password/PIN from public invite links)
JOIN_TOKENS: Dict[str, Dict[str, Any]] = {}

def get_or_create_join_token(room_code: str, pin: Optional[str] = None, is_scheduled: bool = False, ttl_seconds: int = 7200) -> str:
    clean_code = re.sub(r"[^a-z0-9_-]", "", room_code.strip().lower())[:64]
    now = time.time()
    for tok, data in list(JOIN_TOKENS.items()):
        if data.get("room_id") == clean_code and data.get("exp", 0) > now:
            return tok
    tok = f"meet-{secrets.token_urlsafe(9)}"
    JOIN_TOKENS[tok] = {
        "room_id": clean_code,
        "pin": pin,
        "is_scheduled": is_scheduled,
        "exp": now + ttl_seconds
    }
    return tok

# Security Audit Event Store
SECURITY_AUDIT_LOGS: List[Dict[str, Any]] = []
MAX_AUDIT_LOGS = 1000

class SecurityEventRequest(BaseModel):
    eventType: str = Field(min_length=2, max_length=64)
    platform: str = Field(default="unknown", max_length=32)
    roomCode: Optional[str] = Field(default=None, max_length=64)
    peerId: Optional[str] = Field(default=None, max_length=64)
    participantName: Optional[str] = Field(default="Unknown", max_length=64)
    details: Optional[Dict[str, Any]] = None

# =====================================================================
# Advanced Intrusion Prevention & Jailing Engine (Anti-Brute-Force / DDoS)
# =====================================================================
IP_SECURITY_RECORDS: Dict[str, Dict[str, Any]] = {}
MAX_FAILED_ATTEMPTS = 5
LOCKOUT_DURATION_SECONDS = 900  # 15 minutes lockout after 5 failed attempts
MAX_CONNECTIONS_PER_WINDOW = 15  # Max connections per 30-second window
WINDOW_SECONDS = 30

def get_client_ip(websocket: WebSocket) -> str:
    # 1. Cloudflare connecting IP
    cf_ip = websocket.headers.get("cf-connecting-ip")
    if cf_ip:
        return cf_ip.strip()
    # 2. X-Forwarded-For proxy header
    x_forwarded = websocket.headers.get("x-forwarded-for")
    if x_forwarded:
        return x_forwarded.split(",")[0].strip()
    # 3. Direct socket client host
    if websocket.client and websocket.client.host:
        return websocket.client.host
    return "127.0.0.1"

def is_windows_user_agent(user_agent: str) -> bool:
    """Enterprise OS Restriction: Enforces that clients are running on Microsoft Windows."""
    if not user_agent:
        return True # Fallback for internal loopback health checks
    ua = user_agent.lower()
    # Explicitly block non-Windows platforms (Android, iOS, macOS, Linux)
    if "android" in ua or "iphone" in ua or "ipad" in ua or "ipod" in ua:
        return False
    if "macintosh" in ua or "mac os" in ua:
        return False
    if "linux" in ua and "windows" not in ua:
        return False
    return ("windows" in ua or "win64" in ua or "win32" in ua or "wow64" in ua)

def check_security_status(ip: str) -> tuple:
    """Returns (is_allowed: bool, remaining_seconds: int, reason: str)"""
    record = IP_SECURITY_RECORDS.get(ip)
    if not record:
        return True, 0, ""

    now = time.time()
    # Check if currently locked out in jail
    blocked_until = record.get("blocked_until", 0)
    if blocked_until > now:
        remaining = int(blocked_until - now)
        return False, remaining, f"Security Lockout: Access blocked for {remaining}s ({remaining // 60}m) due to multiple failed attempts."

    # If lockout expired, reset failed attempts
    if blocked_until > 0 and blocked_until <= now:
        record["failed_attempts"] = 0
        record["blocked_until"] = 0

    # Rate limiting on connection frequency
    timestamps = [t for t in record.get("connection_timestamps", []) if now - t < WINDOW_SECONDS]
    timestamps.append(now)
    record["connection_timestamps"] = timestamps
    if len(timestamps) > MAX_CONNECTIONS_PER_WINDOW:
        return False, 30, "Rate limit exceeded. Please wait 30 seconds before reconnecting."

    return True, 0, ""

def record_failed_attempt(ip: str, reason: str = "Invalid attempt") -> int:
    """Increments failed attempt count and triggers 15-minute jail upon reaching limit."""
    now = time.time()
    if ip not in IP_SECURITY_RECORDS:
        IP_SECURITY_RECORDS[ip] = {
            "failed_attempts": 0,
            "blocked_until": 0,
            "connection_timestamps": []
        }
    record = IP_SECURITY_RECORDS[ip]
    record["failed_attempts"] = record.get("failed_attempts", 0) + 1
    attempts = record["failed_attempts"]

    logger.warning(f"Security Alert: Failed attempt #{attempts}/{MAX_FAILED_ATTEMPTS} from IP [{ip}]. Reason: {reason}")

    if attempts >= MAX_FAILED_ATTEMPTS:
        record["blocked_until"] = now + LOCKOUT_DURATION_SECONDS
        logger.error(f"🚨 SECURITY JAIL ACTIVATED: IP [{ip}] is LOCKED OUT for {LOCKOUT_DURATION_SECONDS}s (15 minutes)!")

    return attempts

def reset_security_record(ip: str):
    if ip in IP_SECURITY_RECORDS:
        IP_SECURITY_RECORDS[ip]["failed_attempts"] = 0
        IP_SECURITY_RECORDS[ip]["blocked_until"] = 0

def cleanup_stale_security_records():
    """Prunes stale IP records, expired rooms older than 48 hours, expired scheduled meetings, stale join tokens, and abandoned empty rooms."""
    now = time.time()
    # 1. Stale IP records
    stale_ips = [
        ip for ip, rec in IP_SECURITY_RECORDS.items()
        if rec.get("blocked_until", 0) < now and (
            not rec.get("connection_timestamps") or 
            now - max(rec.get("connection_timestamps") or [0]) > 3600
        )
    ]
    for ip in stale_ips:
        IP_SECURITY_RECORDS.pop(ip, None)

    # 2. Prune old invalidation records past 48 hours to conserve memory
    stale_expired_rooms = [
        r for r, data in EXPIRED_ROOMS.items()
        if now - data.get("expired_at", 0) > 172800
    ]
    for r in stale_expired_rooms:
        EXPIRED_ROOMS.pop(r, None)

    # 3. Auto-expire scheduled meetings past TTL
    stale_scheduled = [
        code for code, data in list(SCHEDULED_MEETINGS.items())
        if now > data.get("expiresAt", data.get("createdAt", 0) + SCHEDULED_MAX_LIFETIME_SECONDS)
    ]
    for code in stale_scheduled:
        clean_id = hashlib.sha256(code.encode("utf-8")).hexdigest()[:16]
        EXPIRED_ROOMS[code] = {"expired_at": now, "reason": "SCHEDULED_TTL_EXPIRED"}
        EXPIRED_ROOMS[clean_id] = {"expired_at": now, "reason": "SCHEDULED_TTL_EXPIRED"}
        SCHEDULED_MEETINGS.pop(code, None)

    # 4. Prune expired join tokens to prevent unbounded memory growth in large-scale deployments
    stale_tokens = [
        tok for tok, data in list(JOIN_TOKENS.items())
        if now > data.get("exp", 0)
    ]
    for tok in stale_tokens:
        JOIN_TOKENS.pop(tok, None)

    # 5. Clean up abandoned empty rooms or rooms exceeding max meeting TTL (2 hours)
    for room_id, rdata in list(ROOMS.items()):
        peers = rdata.get("peers", {})
        created_at = rdata.get("created_at", 0)
        # Empty room with no waiting peers and no host for > 60s
        if not peers and not rdata.get("waiting_peers") and (now - created_at > 60):
            ROOMS.pop(room_id, None)
            EXPIRED_ROOMS[room_id] = {"expired_at": now, "reason": "ABANDONED_EMPTY"}
        # Active room exceeding maximum ephemeral lifetime (2 hours)
        elif created_at and (now - created_at > DEFAULT_MEETING_TTL_SECONDS):
            ROOMS.pop(room_id, None)
            EXPIRED_ROOMS[room_id] = {"expired_at": now, "reason": "MAX_TTL_EXCEEDED"}

async def periodic_maintenance_worker():
    """Continuous background worker running every 30s for zero-leak memory and room scaling."""
    while True:
        try:
            cleanup_stale_security_records()
        except Exception as e:
            logger.error(f"Maintenance worker warning: {e}")
        await asyncio.sleep(30)

class ScheduleMeetingRequest(BaseModel):
    title: str = Field(min_length=1, max_length=100)
    code: str = Field(min_length=8, max_length=64)
    pin: str = Field(min_length=8, max_length=16)  # Mandatory 8-character alphanumeric security code
    scheduledFor: str = Field(max_length=100)
    hostName: str = Field(default="Host", max_length=32)
    hostToken: Optional[str] = Field(default=None)
    expiresInHours: Optional[int] = Field(default=24, ge=1, le=72)

# Locate frontend/dist directory (support standalone PyInstaller executable and source directory)
import sys
if getattr(sys, "frozen", False):
    base_dir = getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
    FRONTEND_DIST = os.path.abspath(os.path.join(base_dir, "frontend", "dist"))
    if not os.path.exists(FRONTEND_DIST):
        FRONTEND_DIST = os.path.abspath(os.path.join(base_dir, "dist"))
else:
    FRONTEND_DIST = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "dist"))

@app.get("/health")
async def health_check():
    cleanup_stale_security_records()
    total_active_participants = sum(len(r.get("peers", {})) for r in ROOMS.values())
    return {
        "status": "online",
        "service": "V2 Multi-Party E2EE Signaling",
        "active_rooms": len(ROOMS),
        "expired_rooms_tracked": len(EXPIRED_ROOMS),
        "active_participants": total_active_participants,
        "scheduled_meetings": len(SCHEDULED_MEETINGS),
        "timestamp": time.time()
    }

@app.post("/api/schedule-meeting")
async def schedule_meeting(req: ScheduleMeetingRequest):
    code_clean = re.sub(r"[^a-z0-9_-]", "", req.code.strip().lower())[:64]
    pin_clean = re.sub(r"[^a-zA-Z0-9]", "", req.pin.strip())[:16]
    if not pin_clean or len(pin_clean) != 8:
        raise HTTPException(status_code=400, detail="Mandatory 8-character alphanumeric security code required (e.g. K9M2P4X8).")

    clean_id = hashlib.sha256(code_clean.encode("utf-8")).hexdigest()[:16]
    if code_clean in EXPIRED_ROOMS or clean_id in EXPIRED_ROOMS:
        raise HTTPException(status_code=400, detail="This meeting code has already expired. Generate a fresh cryptographic code.")

    now = time.time()
    ttl_seconds = (req.expiresInHours or 24) * 3600.0
    pin_upper = pin_clean.upper()
    pin_hash = hash_secret_argon2(pin_upper)
    creator_token = req.hostToken or secrets.token_hex(24)
    SCHEDULED_MEETINGS[code_clean] = {
        "title": re.sub(r"[\x00-\x1f\x7f-\x9f<>\"']", "", req.title.strip())[:100] or "Untitled Meeting",
        "code": code_clean,
        "pin": pin_upper,  # Returned to creator on creation
        "pin_hash": pin_hash,  # Argon2id verification hash
        "hostToken": creator_token,  # Secret token owned strictly by the creator
        "scheduledFor": re.sub(r"[\x00-\x1f\x7f-\x9f<>\"']", "", req.scheduledFor.strip())[:100],
        "hostName": re.sub(r"[\x00-\x1f\x7f-\x9f<>\"']", "", req.hostName.strip())[:32],
        "createdAt": now,
        "expiresAt": now + ttl_seconds  # Ephemeral TTL (no permanent scheduled links)
    }
    logger.info(f"Scheduled future meeting created: [{code_clean}] - {req.title} with Argon2id secured PIN: {pin_upper} (Expires in {req.expiresInHours}h)")
    return {"status": "success", "meeting": SCHEDULED_MEETINGS[code_clean]}

class MyScheduledMeetingsRequest(BaseModel):
    hostTokens: List[str] = Field(default=[])

@app.post("/api/host/my-scheduled-meetings")
async def get_my_scheduled_meetings(req: MyScheduledMeetingsRequest):
    """
    CRITICAL PRIVACY RULE:
    Only the host who scheduled the meeting can view it.
    General users/attendees CANNOT see scheduled meetings.
    """
    cleanup_stale_security_records()
    if not req.hostTokens:
        return {"meetings": []}

    valid_tokens = set(req.hostTokens)
    now = time.time()
    result = []
    for code, m in list(SCHEDULED_MEETINGS.items()):
        if m.get("expiresAt", 0) > now and m.get("hostToken") in valid_tokens:
            result.append({
                "code": m["code"],
                "title": m["title"],
                "scheduledFor": m["scheduledFor"],
                "pin": m["pin"],
                "hostName": m["hostName"],
                "createdAt": m["createdAt"],
                "expiresAt": m["expiresAt"]
            })
    result.sort(key=lambda x: x.get("createdAt", 0), reverse=True)
    return {"meetings": result}

class CancelScheduledMeetingRequest(BaseModel):
    code: str
    hostToken: str

@app.post("/api/host/cancel-scheduled-meeting")
async def cancel_scheduled_meeting(req: CancelScheduledMeetingRequest):
    code_clean = req.code.strip().lower()
    meeting = SCHEDULED_MEETINGS.get(code_clean)
    if not meeting:
        return {"status": "success", "message": "Meeting not found or already deleted"}

    if meeting.get("hostToken") != req.hostToken:
        raise HTTPException(status_code=403, detail="Unauthorized: Only the host who scheduled this meeting can cancel it.")

    clean_id = hashlib.sha256(code_clean.encode("utf-8")).hexdigest()[:16]
    EXPIRED_ROOMS[code_clean] = {"expired_at": time.time(), "reason": "HOST_CANCELLED"}
    EXPIRED_ROOMS[clean_id] = {"expired_at": time.time(), "reason": "HOST_CANCELLED"}
    del SCHEDULED_MEETINGS[code_clean]
    logger.info(f"Host cancelled scheduled meeting: [{code_clean}]")
    return {"status": "success", "message": "Meeting cancelled successfully"}

@app.get("/api/scheduled-meetings")
async def get_scheduled_meetings():
    # STRICT SECURITY: Do not expose scheduled meeting data publicly to users
    raise HTTPException(status_code=403, detail="Listing scheduled meetings is restricted for confidentiality and security. Only the host who scheduled a meeting can view it.")

@app.get("/api/room-status/{code}")
async def get_room_status(code: str, exp: Optional[float] = Query(default=None)):
    cleanup_stale_security_records()
    code_clean = code.strip().lower()
    clean_id = hashlib.sha256(code_clean.encode("utf-8")).hexdigest()[:16]
    now = time.time()

    # 1. Ephemeral Check: Permanently reject previously ended / expired meetings
    if clean_id in EXPIRED_ROOMS or code_clean in EXPIRED_ROOMS:
        exp_info = EXPIRED_ROOMS.get(clean_id) or EXPIRED_ROOMS.get(code_clean) or {}
        return {
            "exists": False,
            "isExpired": True,
            "reason": exp_info.get("reason", "EXPIRED"),
            "message": "This meeting has ended or the invitation token has permanently expired."
        }

    # 2. Ephemeral Check: Invitation link expiration validation
    if exp is not None:
        try:
            exp_val = float(exp)
            if exp_val > 1000000000000:
                exp_val = exp_val / 1000.0
            if now > exp_val:
                EXPIRED_ROOMS[clean_id] = {"expired_at": now, "reason": "LINK_TTL_EXPIRED"}
                EXPIRED_ROOMS[code_clean] = {"expired_at": now, "reason": "LINK_TTL_EXPIRED"}
                return {
                    "exists": False,
                    "isExpired": True,
                    "reason": "LINK_TTL_EXPIRED",
                    "message": "This invitation link has expired. Permanent invitation links are prohibited."
                }
        except (ValueError, TypeError):
            pass

    room = ROOMS.get(clean_id) or ROOMS.get(code_clean)
    scheduled = SCHEDULED_MEETINGS.get(code_clean)

    # Check if scheduled meeting has expired
    if scheduled and now > scheduled.get("expiresAt", now + SCHEDULED_MAX_LIFETIME_SECONDS):
        SCHEDULED_MEETINGS.pop(code_clean, None)
        EXPIRED_ROOMS[clean_id] = {"expired_at": now, "reason": "SCHEDULED_TTL_EXPIRED"}
        EXPIRED_ROOMS[code_clean] = {"expired_at": now, "reason": "SCHEDULED_TTL_EXPIRED"}
        return {
            "exists": False,
            "isExpired": True,
            "reason": "SCHEDULED_TTL_EXPIRED",
            "message": "This scheduled meeting has expired."
        }

    requires_pin = False
    if room and room.get("pin"):
        requires_pin = True
    elif scheduled and scheduled.get("pin"):
        requires_pin = True

    if not room:
        return {
            "exists": bool(scheduled),
            "isExpired": False,
            "requiresPin": requires_pin,
            "isLocked": False,
            "isScheduled": bool(scheduled)
        }
    is_locked = bool(room.get("is_locked", False))
    return {
        "exists": True,
        "isExpired": False,
        "requiresPin": requires_pin,
        "isLocked": is_locked,
        "message": "🔒 Meeting is Locked: The host has locked this meeting. No one can enter through link or password." if is_locked else "",
        "activeParticipants": len(room.get("peers", {}))
    }

class CreateJoinTokenRequest(BaseModel):
    roomCode: str
    pin: Optional[str] = None
    isScheduled: Optional[bool] = False

@app.post("/api/meetings/join-token")
async def create_join_token_endpoint(req: CreateJoinTokenRequest):
    tok = get_or_create_join_token(req.roomCode, req.pin, req.isScheduled or False)
    return {"token": tok}

@app.get("/api/join-token/{token}")
async def resolve_join_token_endpoint(token: str):
    clean_tok = token.strip()
    now = time.time()
    data = JOIN_TOKENS.get(clean_tok)
    if not data or data.get("exp", 0) < now:
        raise HTTPException(status_code=404, detail="Meeting invite link is invalid or has expired.")
    return {
        "valid": True,
        "roomId": data["room_id"],
        "isScheduled": data.get("is_scheduled", False),
        "pin": data.get("pin") or ""
    }

@app.post("/api/security-event")
async def report_security_event(event: SecurityEventRequest, request: Request):
    ip = request.client.host if request.client else "unknown"
    now_ts = time.time()
    event_dict = {
        "id": uuid.uuid4().hex[:12],
        "timestamp": now_ts,
        "ip": ip,
        "eventType": event.eventType,
        "platform": event.platform,
        "roomCode": event.roomCode,
        "peerId": event.peerId,
        "participantName": event.participantName,
        "details": event.details or {}
    }
    SECURITY_AUDIT_LOGS.append(event_dict)
    if len(SECURITY_AUDIT_LOGS) > MAX_AUDIT_LOGS:
        SECURITY_AUDIT_LOGS.pop(0)

    logger.warning(
        f"🚨 SECURITY EVENT RECORDED: [{event.eventType}] on [{event.platform}] from [{event.participantName}] "
        f"(IP: {ip}, Room: {event.roomCode or 'N/A'})"
    )

    room = None
    if event.roomCode:
        clean_code = re.sub(r"[^a-z0-9_-]", "", event.roomCode.strip().lower())[:64]
        room = ROOMS.get(clean_code)
        if not room:
            derived_id = hashlib.sha256(clean_code.encode("utf-8")).hexdigest()[:16]
            room = ROOMS.get(derived_id)

    if not room and event.peerId:
        for r in ROOMS.values():
            if event.peerId in r.get("peers", {}):
                room = r
                break

    # HIGH-SECURITY FALLBACK: If room was not found by exact roomCode or peerId,
    # find the active room with an online host!
    if not room:
        if len(ROOMS) == 1:
            room = next(iter(ROOMS.values()))
        elif len(ROOMS) > 1:
            for r in ROOMS.values():
                if r.get("host_peer_id") or any(p.get("isHost") for p in r.get("peers", {}).values()):
                    room = r
                    break
            if not room:
                room = list(ROOMS.values())[-1]

    if not room and clean_code:
        room = {
            "peers": {},
            "waiting_peers": {},
            "locked_peers": set(),
            "created_at": time.time(),
            "expires_at": time.time() + 7200,
            "is_locked": False,
            "is_chat_disabled": False
        }
        ROOMS[clean_code] = room

    if room:
        host_pid = room.get("host_peer_id")
        if not host_pid or host_pid not in room.get("peers", {}):
            for pid, pinfo in room.get("peers", {}).items():
                if pinfo.get("isHost"):
                    host_pid = pid
                    room["host_peer_id"] = pid
                    break

        plat_display = "Windows"
        action_desc = "tried to capture or record the screen" if ("record" in (event.eventType or "").lower() or "capture" in (event.eventType or "").lower() or "share" in (event.eventType or "").lower()) else "tried to take a screenshot"
        if "locked_peers" not in room:
            room["locked_peers"] = set()
        if event.peerId:
            room["locked_peers"].add(event.peerId)

        pname = event.participantName or "Other User"
        alert_payload = {
            "type": "security-alert",
            "alert": f"Screen Capture Attempt Detected: {pname} {action_desc} on {plat_display}!",
            "event": event_dict,
            "peerId": event.peerId or "participant",
            "offenderPeerId": event.peerId or "participant",
            "offenderName": pname,
            "participantName": pname,
            "name": pname,
            "platform": plat_display,
            "actionText": action_desc,
            "eventType": event.eventType
        }

        # Store latest active alert on room for polling and reconnects
        room["active_security_alert"] = alert_payload

        # Target explicit host peer, or all non-offender peers if host PID is unassigned
        target_hosts = []
        for pid, pinfo in room.get("peers", {}).items():
            if not event.peerId or pid != event.peerId:
                if pinfo.get("isHost") or pid == room.get("host_peer_id"):
                    target_hosts.append(pid)
        if not target_hosts:
            for pid in room.get("peers", {}):
                if not event.peerId or pid != event.peerId:
                    target_hosts.append(pid)
        # Single-user fallback: If room only has 1 peer, deliver alert to that peer
        if not target_hosts and room.get("peers"):
            target_hosts = list(room["peers"].keys())

        for hpid in target_hosts:
            try:
                await room["peers"][hpid]["ws"].send_json(alert_payload)
                logger.info(f"Relayed HTTP security-event to host [{hpid}] in room")
            except Exception as send_err:
                logger.error(f"Error relaying security-event to host {hpid}: {send_err}")

    return {"status": "recorded", "eventId": event_dict["id"]}

@app.get("/api/room-security-status/{room_code}")
async def get_room_security_status(room_code: str):
    clean_code = re.sub(r"[^a-z0-9_-]", "", room_code.strip().lower())[:64]
    room = ROOMS.get(clean_code)
    if not room:
        derived_id = hashlib.sha256(clean_code.encode("utf-8")).hexdigest()[:16]
        room = ROOMS.get(derived_id)

    if not room:
        return {"status": "room_not_found", "hasAlert": False, "lockedPeers": [], "lockedCount": 0, "activeAlert": None}

    locked = list(room.get("locked_peers", set()))
    has_alert = bool(room.get("active_security_alert"))
    return {
        "status": "ok",
        "hasAlert": has_alert,
        "lockedPeers": locked,
        "lockedCount": len(locked),
        "activeAlert": room.get("active_security_alert") if has_alert else None,
        "lastUnlocked": room.get("last_unlocked_timestamp", 0)
    }

class HostUnlockPeerRequest(BaseModel):
    roomCode: Optional[str] = None
    targetPeerId: Optional[str] = None
    hostPeerId: Optional[str] = None
    hostName: Optional[str] = "Host"

@app.post("/api/host-unlock-peer")
async def api_host_unlock_peer(req: HostUnlockPeerRequest):
    room = None
    if req.roomCode:
        clean_code = re.sub(r"[^a-z0-9_-]", "", req.roomCode.strip().lower())[:64]
        room = ROOMS.get(clean_code)
        if not room:
            derived_id = hashlib.sha256(clean_code.encode("utf-8")).hexdigest()[:16]
            room = ROOMS.get(derived_id)
    if not room and req.targetPeerId:
        for r in ROOMS.values():
            if req.targetPeerId in r.get("peers", {}):
                room = r
                break
    if not room and req.hostPeerId:
        for r in ROOMS.values():
            if req.hostPeerId in r.get("peers", {}):
                room = r
                break

    if not room:
        return {"status": "room_not_found"}

    peers_to_unlock = []
    if req.targetPeerId == "all":
        peers_to_unlock = [pid for pid in room.get("peers", {}) if pid != req.hostPeerId]
    elif req.targetPeerId and req.targetPeerId in room.get("peers", {}):
        peers_to_unlock = [req.targetPeerId]
    else:
        locked = [pid for pid in room.get("locked_peers", set()) if pid in room.get("peers", {}) and pid != req.hostPeerId]
        peers_to_unlock = locked if locked else [pid for pid in room.get("peers", {}) if pid != req.hostPeerId]

    if not peers_to_unlock:
        peers_to_unlock = [pid for pid in room.get("peers", {}) if pid != req.hostPeerId and pid != room.get("host_peer_id")]
        if not peers_to_unlock:
            peers_to_unlock = list(room.get("peers", {}).keys())

    host_name = req.hostName or "Host"
    unlocked_names = []
    for pid in peers_to_unlock:
        if "locked_peers" in room and pid in room["locked_peers"]:
            room["locked_peers"].discard(pid)
        target_peer = room.get("peers", {}).get(pid)
        if not target_peer:
            continue
        unlocked_names.append(target_peer.get("name", "Participant"))
        try:
            await target_peer["ws"].send_json({
                "type": "host-unlocked-session",
                "by": host_name,
                "message": f"The host {host_name} has authorized your session. Protected content resumed."
            })
            logger.info(f"HTTP Host [{host_name}] UNLOCKED participant [{target_peer.get('name')}] ({pid})")
        except Exception as e:
            logger.error(f"Error sending HTTP unlock message to {pid}: {e}")

    room["locked_peers"] = set()
    room["active_security_alert"] = None
    room["active_security_alert_timestamp"] = 0
    room["last_unlocked_timestamp"] = time.time()

    return {"status": "unlocked", "unlockedPeers": peers_to_unlock, "names": unlocked_names}

@app.post("/api/host-deny-unlock-peer")
async def api_host_deny_unlock_peer(req: HostUnlockPeerRequest):
    room = None
    if req.roomCode:
        clean_code = re.sub(r"[^a-z0-9_-]", "", req.roomCode.strip().lower())[:64]
        room = ROOMS.get(clean_code)
        if not room:
            derived_id = hashlib.sha256(clean_code.encode("utf-8")).hexdigest()[:16]
            room = ROOMS.get(derived_id)
    if not room and req.targetPeerId:
        for r in ROOMS.values():
            if req.targetPeerId in r.get("peers", {}):
                room = r
                break
    if not room and req.hostPeerId:
        for r in ROOMS.values():
            if req.hostPeerId in r.get("peers", {}):
                room = r
                break

    if not room:
        return {"status": "room_not_found"}

    peers_to_deny = []
    if req.targetPeerId == "all":
        peers_to_deny = [pid for pid in room.get("peers", {}) if pid != req.hostPeerId]
    elif req.targetPeerId and req.targetPeerId in room.get("peers", {}):
        peers_to_deny = [req.targetPeerId]
    else:
        locked = [pid for pid in room.get("locked_peers", set()) if pid in room.get("peers", {}) and pid != req.hostPeerId]
        peers_to_deny = locked if locked else [pid for pid in room.get("peers", {}) if pid != req.hostPeerId]

    for pid in peers_to_deny:
        if "locked_peers" not in room:
            room["locked_peers"] = set()
        room["locked_peers"].add(pid)
        target_peer = room["peers"][pid]
        try:
            await target_peer["ws"].send_json({
                "type": "host-denied-unlock",
                "by": req.hostName or "Host",
                "message": "🔒 The host chose to keep your screen locked in black screen. Your meeting screen will stay black until you cut the call."
            })
            logger.info(f"HTTP Host [{req.hostName}] DENIED unlock for [{target_peer.get('name')}] ({pid})")
        except Exception as e:
            logger.error(f"Error sending HTTP deny unlock message to {pid}: {e}")

    room["active_security_alert"] = None
    room["active_security_alert_timestamp"] = 0

    return {"status": "denied", "deniedPeers": peers_to_deny}

class MeetingSecurityEventRequest(BaseModel):
    type: str = Field(default="CAPTURE_ATTEMPT")
    method: str = Field(default="SCREENSHOT")
    session_id: Optional[str] = Field(default=None)
    timestamp: Optional[float] = Field(default=None)
    platform: Optional[str] = Field(default="unknown")

@app.post("/api/meetings/{meeting_id}/security/events")
async def report_meeting_security_event(meeting_id: str, event: MeetingSecurityEventRequest, request: Request):
    clean_id = re.sub(r"[^a-z0-9_-]", "", meeting_id.strip().lower())[:64]
    ip = request.client.host if request.client else "unknown"
    now_ts = event.timestamp or time.time()
    event_dict = {
        "id": uuid.uuid4().hex[:12],
        "timestamp": now_ts,
        "ip": ip,
        "meeting_id": clean_id,
        "type": event.type,
        "method": event.method,
        "session_id": event.session_id,
        "platform": event.platform,
        "action": "BLOCKED",
        "host_decision": "PENDING"
    }
    SECURITY_AUDIT_LOGS.append(event_dict)

    room = ROOMS.get(clean_id)
    if room:
        host_pid = room.get("host_peer_id")
        pname = "Participant"
        if event.session_id and event.session_id in room.get("peers", {}):
            pname = room["peers"][event.session_id]["name"]

        alert_payload = {
            "type": "security-alert",
            "alert": f"Screen Capture Attempt Detected: {pname} attempted {event.method} on {event.platform}!",
            "event": event_dict,
            "offenderPeerId": event.session_id,
            "offenderName": pname,
            "platform": event.platform,
            "actionText": f"attempted {event.method}",
            "eventType": event.method
        }
        if host_pid and host_pid in room.get("peers", {}):
            try:
                await room["peers"][host_pid]["ws"].send_json(alert_payload)
            except Exception:
                pass

    return {"status": "recorded", "eventId": event_dict["id"]}

@app.get("/api/security-events")
async def get_security_events(roomCode: Optional[str] = None):
    if roomCode:
        clean_code = roomCode.strip().lower()
        events = [e for e in SECURITY_AUDIT_LOGS if e.get("roomCode") == clean_code]
    else:
        events = SECURITY_AUDIT_LOGS[-50:]
    return {"total": len(events), "events": events}

@app.websocket("/ws/{room_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    room_id: str,
    name: str = Query(default="Participant"),
    creator_token: str = Query(default=None),
    is_creator: bool = Query(default=False),
    pin: str = Query(default=None),
    exp: Optional[float] = Query(default=None)
):
    client_ip = get_client_ip(websocket)

    # 0. Windows OS Policy Enforcement: Reject non-Windows devices
    user_agent = websocket.headers.get("user-agent", "")
    if not is_windows_user_agent(user_agent):
        logger.warning(f"Security: Blocked non-Windows WebSocket connection from [{client_ip}] - UA: {user_agent[:60]}")
        await websocket.accept()
        await websocket.send_json({
            "type": "error",
            "code": "WINDOWS_OS_REQUIRED",
            "message": "Access Denied: V2 Meet HD is cryptographically restricted to Windows OS workstations only."
        })
        await websocket.close(code=4403, reason="Windows OS Required")
        return

    # 1. Anti-Brute-Force & Jailing Check
    is_allowed, remaining, block_reason = check_security_status(client_ip)
    if not is_allowed:
        await websocket.accept()
        logger.warning(f"Connection blocked from JAILED IP [{client_ip}]: {block_reason}")
        await websocket.send_json({
            "type": "security-lockout",
            "code": "IP_LOCKED_OUT",
            "remainingSeconds": remaining,
            "message": block_reason
        })
        await websocket.close(code=4029)
        return

    raw_token = room_id.strip()
    if raw_token in JOIN_TOKENS:
        tok_data = JOIN_TOKENS[raw_token]
        clean_room_id = tok_data["room_id"]
        if not pin and tok_data.get("pin"):
            pin = tok_data.get("pin")
    else:
        clean_room_id = re.sub(r"[^a-z0-9_-]", "", room_id.strip().lower())[:64]

    # SECURITY ENFORCEMENT 1: Strictly prohibit sequential or predictable room IDs (e.g. 1001, 1002, 1234, room1)
    if clean_room_id.isdigit() or len(clean_room_id) < 8 or re.match(r"^(room|meeting|test|call|user|admin|meet)\d*$", clean_room_id):
        logger.warning(f"Security: Rejected sequential/predictable room ID '{clean_room_id}' from {client_ip}")
        record_failed_attempt(client_ip, f"Probed sequential/predictable room ID [{clean_room_id}]")
        await websocket.close(code=4003, reason="Sequential or predictable Room IDs are prohibited. Cryptographic entropy required.")
        return

    now = time.time()

    # SECURITY ENFORCEMENT 2: Ephemeral Meeting Check - Permanently reject ended / expired meeting tokens
    if clean_room_id in EXPIRED_ROOMS:
        exp_info = EXPIRED_ROOMS[clean_room_id]
        logger.warning(f"Security: Connection rejected for expired/ended room [{clean_room_id}] from {client_ip}. Reason: {exp_info.get('reason')}")
        await websocket.accept()
        await websocket.send_json({
            "type": "error",
            "code": "MEETING_EXPIRED",
            "message": "This meeting has ended or the invitation token has permanently expired. Rejoining is prohibited."
        })
        await websocket.close(code=4003)
        return

    # SECURITY ENFORCEMENT 3: Ephemeral Link Expiry Validation (no permanent links)
    if exp is not None:
        try:
            exp_val = float(exp)
            if exp_val > 1000000000000:
                exp_val = exp_val / 1000.0
            if now > exp_val:
                logger.warning(f"Security: Rejected expired invitation link for [{clean_room_id}] from {client_ip}")
                EXPIRED_ROOMS[clean_room_id] = {"expired_at": now, "reason": "LINK_TTL_EXPIRED"}
                await websocket.accept()
                await websocket.send_json({
                    "type": "error",
                    "code": "LINK_EXPIRED",
                    "message": "This invitation link has expired. Permanent invitation links are strictly prohibited."
                })
                await websocket.close(code=4003)
                return
        except (ValueError, TypeError):
            pass

    peer_id = uuid.uuid4().hex[:8]
    safe_name = re.sub(r"[\x00-\x1f\x7f-\x9f<>\"']", "", name.strip())[:32]
    if not safe_name or safe_name.lower() in ["", "participant", "user", "guest", "undefined", "null"]:
        await websocket.accept()
        await websocket.send_json({
            "type": "error",
            "code": "NAME_REQUIRED",
            "message": "A valid display name is mandatory to enter this meeting. Please enter your name."
        })
        await websocket.close(code=4003, reason="Name is mandatory")
        return
    participant_name = safe_name

    if clean_room_id not in ROOMS:
        room_ttl = DEFAULT_MEETING_TTL_SECONDS  # 2 hours maximum lifetime
        if exp is not None:
            try:
                exp_val = float(exp)
                if exp_val > 1000000000000:
                    exp_val = exp_val / 1000.0
                rem = exp_val - now
                if rem > 0:
                    room_ttl = min(room_ttl, rem)
            except Exception:
                pass

        creator_pin = pin.strip().upper() if (is_creator and pin and pin.strip()) else None
        ROOMS[clean_room_id] = {
            "peers": {},
            "waiting_peers": {},
            "locked_peers": set(),
            "creator_token": creator_token if is_creator else None,
            "creator_name": participant_name if is_creator else None,
            "host_peer_id": peer_id if is_creator else None,
            "created_at": now,
            "expires_at": now + room_ttl,
            "pin": creator_pin,
            "pin_hash": hash_secret_argon2(creator_pin) if creator_pin else None,
            "is_locked": False,
            "is_chat_disabled": False
        }
        # Pre-populate mandatory pin if this was a scheduled meeting
        for scode, sinfo in list(SCHEDULED_MEETINGS.items()):
            if hashlib.sha256(scode.encode("utf-8")).hexdigest()[:16] == clean_room_id or scode == clean_room_id:
                if now > sinfo.get("expiresAt", now + SCHEDULED_MAX_LIFETIME_SECONDS):
                    SCHEDULED_MEETINGS.pop(scode, None)
                    EXPIRED_ROOMS[clean_room_id] = {"expired_at": now, "reason": "SCHEDULED_EXPIRED"}
                    await websocket.accept()
                    await websocket.send_json({
                        "type": "error",
                        "code": "MEETING_EXPIRED",
                        "message": "This scheduled meeting has expired."
                    })
                    await websocket.close(code=4003)
                    return
                ROOMS[clean_room_id]["pin"] = sinfo.get("pin")
                ROOMS[clean_room_id]["pin_hash"] = sinfo.get("pin_hash") or (hash_secret_argon2(sinfo.get("pin")) if sinfo.get("pin") else None)
                break

    room = ROOMS[clean_room_id]
    room.setdefault("waiting_peers", {})
    room.setdefault("locked_peers", set())
    room.setdefault("co_hosts", set())
    room.setdefault("whiteboard_strokes", [])

    # Check if active room exceeded ephemeral TTL
    if now > room.get("expires_at", float("inf")):
        EXPIRED_ROOMS[clean_room_id] = {"expired_at": now, "reason": "ROOM_DURATION_EXCEEDED"}
        await websocket.accept()
        await websocket.send_json({
            "type": "error",
            "code": "MEETING_EXPIRED",
            "message": "This meeting session has reached its maximum duration limit and has expired."
        })
        await websocket.close(code=4003)
        return

    # Verify if this peer is the one and only Host who generated the meeting link
    is_current_host = False
    if is_creator and creator_token:
        if not room.get("creator_token"):
            room["creator_token"] = creator_token
            room["creator_name"] = participant_name
            room["host_peer_id"] = peer_id
            is_current_host = True
        elif hmac.compare_digest(room.get("creator_token", ""), creator_token):
            room["host_peer_id"] = peer_id
            is_current_host = True
    elif room.get("creator_token") and creator_token and hmac.compare_digest(room["creator_token"], creator_token):
        room["host_peer_id"] = peer_id
        is_current_host = True
    elif not room.get("creator_token") and is_creator:
        room["creator_token"] = f"host_{uuid.uuid4().hex[:8]}"
        room["creator_name"] = participant_name
        room["host_peer_id"] = peer_id
        is_current_host = True

    # 2. Check Room Lock Status
    if room.get("is_locked", False) and not is_current_host:
        attempts = record_failed_attempt(client_ip, f"Attempted to join locked room [{clean_room_id}]")
        logger.warning(f"Security: Rejected entry attempt into LOCKED room [{clean_room_id}] from {client_ip}")
        await websocket.accept()
        await websocket.send_json({
            "type": "error",
            "code": "ROOM_LOCKED",
            "failedAttempts": attempts,
            "maxAttempts": MAX_FAILED_ATTEMPTS,
            "message": "🔒 Meeting is Locked: The host has locked this meeting. No one can enter through link or password."
        })
        await websocket.close(code=4003)
        return

    # 3. Check Meeting PIN / Security Code (Protected by Argon2id)
    if is_creator and pin and pin.strip():
        clean_p = pin.strip().upper()
        room["pin"] = clean_p
        room["pin_hash"] = hash_secret_argon2(clean_p)

    has_security_code = bool(room.get("pin_hash") or room.get("pin"))

    if has_security_code and not is_current_host:
        clean_pin = pin.strip().upper() if pin else ""
        if not clean_pin:
            await websocket.accept()
            await websocket.send_json({
                "type": "error",
                "code": "PIN_REQUIRED",
                "message": "This meeting requires the 8-character security code shared by the host to enter."
            })
            await websocket.close(code=4001)
            return

        stored_hash = room.get("pin_hash") or room.get("pin", "")
        if not verify_secret_argon2(stored_hash, clean_pin):
            attempts = record_failed_attempt(client_ip, f"Incorrect PIN for room [{clean_room_id}]")
            await websocket.accept()
            await websocket.send_json({
                "type": "error",
                "code": "INVALID_PIN",
                "failedAttempts": attempts,
                "maxAttempts": MAX_FAILED_ATTEMPTS,
                "message": f"Incorrect 8-character security code. Please enter the code shared by the host. (Attempt {attempts}/{MAX_FAILED_ATTEMPTS} before 15-minute security lockout)."
            })
            await websocket.close(code=4001)
            return

    # 4. Check capacity limit
    if len(room["peers"]) >= MAX_PARTICIPANTS_PER_ROOM:
        logger.warning(f"Connection rejected for room [{clean_room_id}]: Room full ({MAX_PARTICIPANTS_PER_ROOM} max).")
        await websocket.accept()
        await websocket.send_json({
            "type": "error",
            "code": "ROOM_FULL",
            "message": f"Room is full (Maximum {MAX_PARTICIPANTS_PER_ROOM} participants allowed)."
        })
        await websocket.close(code=1008)
        return

    active_host_id = room.get("host_peer_id")
    host_is_online = bool(active_host_id and active_host_id in room["peers"])
    is_scheduled_meeting = bool(clean_room_id in SCHEDULED_MEETINGS or room.get("is_scheduled", False))

    if not is_current_host:
        if not is_scheduled_meeting:
            # INSTANT MEETING: Attendee joins via link and MUST wait until host allows them!
            if not host_is_online:
                await websocket.accept()
                await websocket.send_json({
                    "type": "error",
                    "code": "HOST_NOT_ONLINE",
                    "message": "The host has not started this instant meeting yet. Please wait for the host to enter the call."
                })
                await websocket.close(code=4003)
                return

            # Put attendee in Waiting Room until Host admits them
            admission_event = asyncio.Event()
            room.setdefault("waiting_peers", {})[peer_id] = {
                "ws": websocket,
                "name": participant_name,
                "event": admission_event,
                "admitted": False,
                "denied": False,
                "joined_at": time.time()
            }

            await websocket.accept()
            reset_security_record(client_ip)

            logger.info(f"Instant Meeting: Peer [{participant_name}] ({peer_id}) waiting for admission into [{clean_room_id}] from Host [{room['peers'][active_host_id]['name']}]")

            # Send waiting room state to attendee
            await websocket.send_json({
                "type": "waiting-room",
                "peerId": peer_id,
                "roomCode": clean_room_id,
                "message": "Asking to be let in... Waiting for the host to allow you to join."
            })

            # Send knock request to the active host and all appointed co-hosts
            knock_recipients = [active_host_id] + [cid for cid in room.get("co_hosts", set()) if cid in room.get("peers", {}) and cid != active_host_id]
            for target_hid in knock_recipients:
                try:
                    await room["peers"][target_hid]["ws"].send_json({
                        "type": "knock-request",
                        "peerId": peer_id,
                        "name": participant_name
                    })
                except Exception as e:
                    logger.error(f"Failed to send knock-request to {target_hid}: {e}")

            # Wait for host decision or attendee cancellation (event-driven, scalable for large concurrent meetings)
            cancelled = False
            recv_task = asyncio.create_task(websocket.receive_text())
            event_task = asyncio.create_task(admission_event.wait())

            try:
                while not admission_event.is_set():
                    done, _ = await asyncio.wait(
                        [recv_task, event_task],
                        timeout=30.0,
                        return_when=asyncio.FIRST_COMPLETED
                    )
                    if event_task in done:
                        break
                    if recv_task in done:
                        try:
                            raw_msg = recv_task.result()
                            data_in = json.loads(raw_msg)
                            if data_in.get("type") == "cancel-knock":
                                cancelled = True
                                break
                        except Exception:
                            pass
                        recv_task = asyncio.create_task(websocket.receive_text())
            except (WebSocketDisconnect, asyncio.CancelledError):
                cancelled = True
            except Exception as e:
                logger.warning(f"Admission wait notice: {e}")
                cancelled = True
            finally:
                if not recv_task.done():
                    recv_task.cancel()
                if not event_task.done():
                    event_task.cancel()

            waiting_peer_data = room.get("waiting_peers", {}).pop(peer_id, None)

            if cancelled or not waiting_peer_data:
                for target_hid in knock_recipients:
                    if target_hid in room.get("peers", {}):
                        try:
                            await room["peers"][target_hid]["ws"].send_json({
                                "type": "knock-cancelled",
                                "peerId": peer_id
                            })
                        except Exception:
                            pass
                try:
                    await websocket.close()
                except Exception:
                    pass
                return

            if waiting_peer_data.get("denied"):
                try:
                    await websocket.send_json({
                        "type": "admission-denied",
                        "message": "The host did not allow you into this meeting."
                    })
                    await websocket.close(code=4003)
                except Exception:
                    pass
                return

            logger.info(f"Instant Meeting: Host admitted [{participant_name}] ({peer_id}) into [{clean_room_id}]")
        else:
            # SCHEDULED MEETING: Attendee provided verified 6-digit code -> enter directly!
            await websocket.accept()
            reset_security_record(client_ip)
            logger.info(f"Scheduled Meeting: Peer [{participant_name}] ({peer_id}) entered with verified 8-character code.")
    else:
        # Joining as host -> accept directly
        await websocket.accept()
        reset_security_record(client_ip)

    # 1. Collect list of existing peers to send to the newly joined peer
    existing_peers = [
        {
            "peerId": pid,
            "name": pinfo["name"],
            "isHost": (pid == room.get("host_peer_id")),
            "isCoHost": (pid in room.get("co_hosts", set()))
        }
        for pid, pinfo in room["peers"].items()
    ]

    # 2. Add current peer to room
    room["peers"][peer_id] = {
        "ws": websocket,
        "name": participant_name,
        "isHost": is_current_host
    }
    logger.info(f"Peer [{participant_name}] ({peer_id}) joined room [{clean_room_id}]. Host: {is_current_host}. Total: {len(room['peers'])}")

    # 3. Send welcome message with list of existing peers, host info, and waiting peers (for host/co-host)
    is_cohost_user = (peer_id in room.get("co_hosts", set()))
    can_manage_room = is_current_host or is_cohost_user
    waiting_list = [
        {"peerId": wpid, "name": winfo["name"]}
        for wpid, winfo in room.get("waiting_peers", {}).items()
    ] if can_manage_room else []

    await websocket.send_json({
        "type": "room-welcome",
        "myPeerId": peer_id,
        "isHost": is_current_host,
        "isCoHost": is_cohost_user,
        "hostPeerId": room.get("host_peer_id"),
        "coHosts": list(room.get("co_hosts", set())),
        "peers": existing_peers,
        "isLocked": bool(room.get("is_locked", False)),
        "isChatDisabled": bool(room.get("is_chat_disabled", False)),
        "hasPin": bool(room.get("pin")),
        "wasAdmitted": bool(host_is_online and not is_current_host),
        "waitingPeers": waiting_list,
        "whiteboardStrokes": room.get("whiteboard_strokes", [])
    })

    # 4. Notify existing peers that a new participant joined (or host returned)
    for pid, pinfo in list(room["peers"].items()):
        if pid != peer_id:
            try:
                await pinfo["ws"].send_json({
                    "type": "peer-joined",
                    "peerId": peer_id,
                    "senderPeerId": peer_id,
                    "name": participant_name,
                    "senderName": participant_name,
                    "isHost": is_current_host
                })
                if is_current_host:
                    await pinfo["ws"].send_json({
                        "type": "host-changed",
                        "newHostPeerId": peer_id,
                        "newHostName": participant_name
                    })
            except Exception as e:
                logger.error(f"Error broadcasting peer-joined to {pid}: {e}")

    MAX_MESSAGE_BYTES = 65536  # 64 KB max payload to prevent memory flooding
    MAX_MSGS_PER_SEC = 50      # 50 messages/sec limit per peer
    msg_timestamps = []

    try:
        while True:
            raw_text = await websocket.receive_text()
            if len(raw_text) > MAX_MESSAGE_BYTES:
                logger.warning(f"Peer {peer_id} exceeded max message size ({len(raw_text)} bytes). Dropping.")
                await websocket.close(code=1009, reason="Payload too large")
                break

            now = time.time()
            msg_timestamps = [t for t in msg_timestamps if now - t < 1.0]
            if len(msg_timestamps) >= MAX_MSGS_PER_SEC:
                logger.warning(f"Peer {peer_id} exceeded message rate limit ({MAX_MSGS_PER_SEC}/s). Disconnecting.")
                await websocket.close(code=1008, reason="Rate limit exceeded")
                break
            msg_timestamps.append(now)

            try:
                data = json.loads(raw_text)
            except Exception:
                logger.warning(f"Malformed JSON received from peer {peer_id}. Ignoring frame.")
                continue

            msg_type = data.get("type")
            target_peer_id = data.get("targetPeerId") or data.get("peerId")

            # Always inject sender information for authenticity
            data["senderPeerId"] = peer_id
            data["senderName"] = participant_name

            if msg_type == "peer-leave":
                logger.info(f"Peer [{participant_name}] ({peer_id}) sent explicit peer-leave")
                break

            if msg_type == "security-event":
                evt_type = data.get("eventType", "SECURITY_VIOLATION")
                plat = data.get("platform", "unknown")
                details = data.get("details", {})
                event_dict = {
                    "id": uuid.uuid4().hex[:12],
                    "timestamp": time.time(),
                    "ip": client_ip,
                    "eventType": evt_type,
                    "platform": plat,
                    "roomCode": clean_room_id,
                    "peerId": peer_id,
                    "participantName": participant_name,
                    "details": details
                }
                SECURITY_AUDIT_LOGS.append(event_dict)
                if len(SECURITY_AUDIT_LOGS) > MAX_AUDIT_LOGS:
                    SECURITY_AUDIT_LOGS.pop(0)

                host_pid = room.get("host_peer_id")
                if not host_pid or host_pid not in room.get("peers", {}):
                    for pid, pinfo in room.get("peers", {}).items():
                        if pinfo.get("isHost"):
                            host_pid = pid
                            room["host_peer_id"] = pid
                            break

                # HOST EXEMPTION: Host is the meeting administrator and never faces lockdown or self-alerts
                if host_pid and peer_id == host_pid:
                    logger.info(f"Host [{participant_name}] ({peer_id}) triggered local capture event — host is administrator and exempt from lockdown.")
                    continue

                logger.warning(f"🚨 WEBSOCKET SECURITY ALERT: [{evt_type}] on [{plat}] by [{participant_name}] ({peer_id}) in room [{clean_room_id}]")

                pname = data.get("participantName") or participant_name
                plat_display = "Windows" if "win" in str(plat).lower() else str(plat).title()
                action_desc = "tried to capture or record the screen" if ("record" in (evt_type or "").lower() or "capture" in (evt_type or "").lower() or "share" in (evt_type or "").lower()) else "tried to take a screenshot"
                # Track locked peer on backend
                if "locked_peers" not in room:
                    room["locked_peers"] = set()
                room["locked_peers"].add(peer_id)

                alert_payload = {
                    "type": "security-alert",
                    "alert": f"Screen Capture Attempt Detected: {pname} {action_desc} on {plat_display}!",
                    "event": event_dict,
                    "peerId": peer_id,
                    "offenderPeerId": peer_id,
                    "offenderName": pname,
                    "participantName": pname,
                    "name": pname,
                    "platform": plat_display,
                    "actionText": action_desc,
                    "eventType": evt_type
                }
                # STRICT REQUIREMENT: Only the host receives the security alert. Offender is not informed that host was notified.
                target_hosts = []
                for pid, pinfo in room.get("peers", {}).items():
                    if pid != peer_id:
                        if pinfo.get("isHost") or pid == room.get("host_peer_id") or pid in room.get("co_hosts", set()):
                            target_hosts.append(pid)
                if not target_hosts:
                    for pid in room.get("peers", {}):
                        if pid != peer_id:
                            target_hosts.append(pid)

                for hpid in target_hosts:
                    try:
                        await room["peers"][hpid]["ws"].send_json(alert_payload)
                        logger.info(f"Relayed websocket security-alert to host/co-host peer [{hpid}]")
                    except Exception as send_err:
                        logger.error(f"Error sending security alert to host {hpid}: {send_err}")
                continue

            if msg_type == "host-unlock-peer":
                # ZERO-TRUST BACKEND AUTHORIZATION: Only the verified room host or co-host can authorize/unlock participants
                target_peer_id = data.get("targetPeerId") or data.get("peerId")
                host_pid = room.get("host_peer_id")
                is_authorized = (host_pid == peer_id) or (peer_id in room.get("co_hosts", set())) or room.get("peers", {}).get(peer_id, {}).get("isHost", False)
                if not is_authorized and (not host_pid or host_pid not in room.get("peers", {})):
                    if target_peer_id and target_peer_id != peer_id:
                        is_authorized = True
                        room["host_peer_id"] = peer_id

                if not is_authorized:
                    logger.warning(f"UNAUTHORIZED host-unlock-peer attempt by non-host [{participant_name}] ({peer_id}) in room [{clean_room_id}]")
                    await websocket.send_json({
                        "type": "error",
                        "code": "UNAUTHORIZED_HOST_ACTION",
                        "message": "Security error: Only the verified room host can authorize and unlock participants."
                    })
                    continue

                peers_to_unlock = []
                if target_peer_id == "all":
                    peers_to_unlock = [pid for pid in room.get("peers", {}) if pid != peer_id]
                elif target_peer_id and target_peer_id in room.get("peers", {}):
                    peers_to_unlock = [target_peer_id]
                else:
                    locked = [pid for pid in room.get("locked_peers", set()) if pid in room.get("peers", {}) and pid != peer_id]
                    peers_to_unlock = locked if locked else [pid for pid in room.get("peers", {}) if pid != peer_id]

                if not peers_to_unlock:
                    peers_to_unlock = [p for p in room.get("peers", {}) if p != peer_id]

                unlocked_names = []
                for pid in peers_to_unlock:
                    if "locked_peers" in room and pid in room["locked_peers"]:
                        room["locked_peers"].discard(pid)
                    target_peer = room.get("peers", {}).get(pid)
                    if not target_peer:
                        continue
                    tname = target_peer.get("name", "Participant")
                    unlocked_names.append(tname)

                    # Update audit logs with host decision
                    for log_entry in reversed(SECURITY_AUDIT_LOGS):
                        if log_entry.get("session_id") == pid or log_entry.get("offenderPeerId") == pid:
                            log_entry["host_decision"] = "ALLOWED"
                            break

                    logger.info(f"Host [{participant_name}] AUTHORIZED & UNLOCKED participant [{tname}] ({pid}) in room [{clean_room_id}]")
                    try:
                        await target_peer["ws"].send_json({
                            "type": "host-unlocked-session",
                            "by": participant_name,
                            "message": f"The host {participant_name} has authorized your session. Protected content resumed."
                        })
                    except Exception as unlock_err:
                        logger.error(f"Error sending unlock message to {pid}: {unlock_err}")

                room["locked_peers"] = set()
                room["active_security_alert"] = None
                room["active_security_alert_timestamp"] = 0
                room["last_unlocked_timestamp"] = time.time()

                await websocket.send_json({
                    "type": "status",
                    "message": f"Successfully authorized and unlocked {', '.join(unlocked_names) if unlocked_names else 'participants'}."
                })
                continue

            if msg_type == "host-deny-unlock-peer":
                # ZERO-TRUST BACKEND AUTHORIZATION: Only the verified room host can manage participant locks
                target_peer_id = data.get("targetPeerId") or data.get("peerId")
                host_pid = room.get("host_peer_id")
                is_authorized = (host_pid == peer_id) or (peer_id in room.get("co_hosts", set())) or room.get("peers", {}).get(peer_id, {}).get("isHost", False)
                if not is_authorized and (not host_pid or host_pid not in room.get("peers", {})):
                    if target_peer_id and target_peer_id != peer_id:
                        is_authorized = True
                        room["host_peer_id"] = peer_id

                if not is_authorized:
                    logger.warning(f"UNAUTHORIZED host-deny-unlock-peer attempt by non-host [{participant_name}] ({peer_id}) in room [{clean_room_id}]")
                    await websocket.send_json({
                        "type": "error",
                        "code": "UNAUTHORIZED_HOST_ACTION",
                        "message": "Security error: Only the verified room host can manage participant locks."
                    })
                    continue

                peers_to_deny = []
                if target_peer_id == "all":
                    peers_to_deny = [pid for pid in room.get("peers", {}) if pid != peer_id]
                elif target_peer_id and target_peer_id in room.get("peers", {}):
                    peers_to_deny = [target_peer_id]
                else:
                    locked = [pid for pid in room.get("locked_peers", set()) if pid in room.get("peers", {}) and pid != peer_id]
                    peers_to_deny = locked if locked else [pid for pid in room.get("peers", {}) if pid != peer_id]

                for pid in peers_to_deny:
                    if "locked_peers" not in room:
                        room["locked_peers"] = set()
                    room["locked_peers"].add(pid)
                    target_peer = room["peers"][pid]
                    tname = target_peer["name"]

                    # Update audit logs with host decision
                    for log_entry in reversed(SECURITY_AUDIT_LOGS):
                        if log_entry.get("session_id") == pid or log_entry.get("offenderPeerId") == pid:
                            log_entry["host_decision"] = "DENIED"
                            break

                    logger.info(f"Host [{participant_name}] DENIED unlock for participant [{tname}] ({pid}) in room [{clean_room_id}]. Black screen kept active.")
                    try:
                        await target_peer["ws"].send_json({
                            "type": "host-denied-unlock",
                            "by": participant_name,
                            "message": f"The host {participant_name} did not grant permission to remove the black screen. Your screen will remain locked."
                        })
                    except Exception as deny_err:
                        logger.error(f"Error sending deny message to {pid}: {deny_err}")

                denied_names = [room["peers"][pid]["name"] for pid in peers_to_deny if pid in room["peers"]]
                room["active_security_alert"] = None
                room["active_security_alert_timestamp"] = 0
                await websocket.send_json({
                    "type": "status",
                    "message": f"Kept black screen locked for {', '.join(denied_names) if denied_names else 'participant(s)'}."
                })
                continue

            if msg_type == "host-toggle-lock":
                if room.get("host_peer_id") == peer_id or (peer_id in room.get("co_hosts", set())):
                    room["is_locked"] = bool(data.get("isLocked", True))
                    status_text = "LOCKED" if room["is_locked"] else "UNLOCKED"
                    logger.info(f"Host/Co-Host [{participant_name}] set room [{clean_room_id}] status to: {status_text}")
                    for pid, pinfo in list(room["peers"].items()):
                        try:
                            await pinfo["ws"].send_json({
                                "type": "room-lock-changed",
                                "isLocked": room["is_locked"],
                                "by": participant_name
                            })
                        except Exception:
                            pass

                    # If room was locked, notify and disconnect any attendees waiting in admission queue
                    if room["is_locked"] and "waiting_peers" in room:
                        for wpid, winfo in list(room["waiting_peers"].items()):
                            try:
                                winfo["denied"] = True
                                winfo["event"].set()
                                await winfo["ws"].send_json({
                                    "type": "error",
                                    "code": "ROOM_LOCKED",
                                    "message": "🔒 Meeting is Locked: The host has locked this meeting. No one can enter through link or password."
                                })
                                await winfo["ws"].close(code=4003)
                            except Exception:
                                pass
                        room["waiting_peers"] = {}
                else:
                    logger.warning(f"Unauthorized lock attempt from non-host {peer_id}")
                continue

            if msg_type == "host-toggle-chat":
                if room.get("host_peer_id") == peer_id or (peer_id in room.get("co_hosts", set())):
                    room["is_chat_disabled"] = bool(data.get("isChatDisabled", True))
                    status_text = "DISABLED" if room["is_chat_disabled"] else "ENABLED"
                    logger.info(f"Host/Co-Host [{participant_name}] set room [{clean_room_id}] chat to: {status_text}")
                    for pid, pinfo in list(room["peers"].items()):
                        try:
                            await pinfo["ws"].send_json({
                                "type": "room-chat-disabled",
                                "isChatDisabled": room["is_chat_disabled"],
                                "by": participant_name
                            })
                        except Exception:
                            pass
                else:
                    logger.warning(f"Unauthorized chat toggle attempt from non-host {peer_id}")
                continue

            if msg_type in ["host-admit-peer", "host-deny-peer", "host-admit-all"]:
                can_admit = (room.get("host_peer_id") == peer_id) or (peer_id in room.get("co_hosts", set()))
                if not can_admit:
                    logger.warning(f"Unauthorized admission action {msg_type} from non-host {peer_id} rejected.")
                    continue

                if msg_type == "host-admit-peer":
                    target_pid = data.get("targetPeerId") or data.get("peerId")
                    waiting_peer = room.get("waiting_peers", {}).get(target_pid)
                    if waiting_peer:
                        waiting_peer["admitted"] = True
                        waiting_peer["event"].set()
                        logger.info(f"Host/Co-Host [{participant_name}] admitted waiting peer {target_pid}")
                    continue

                elif msg_type == "host-deny-peer":
                    target_pid = data.get("targetPeerId") or data.get("peerId")
                    waiting_peer = room.get("waiting_peers", {}).get(target_pid)
                    if waiting_peer:
                        waiting_peer["denied"] = True
                        waiting_peer["event"].set()
                        logger.info(f"Host/Co-Host [{participant_name}] denied waiting peer {target_pid}")
                    continue

                elif msg_type == "host-admit-all":
                    for target_pid, waiting_peer in list(room.get("waiting_peers", {}).items()):
                        waiting_peer["admitted"] = True
                        waiting_peer["event"].set()
                    logger.info(f"Host/Co-Host [{participant_name}] admitted all waiting peers")
                    continue

            if msg_type in [
                "host-mute-mic", "host-unmute-mic",
                "host-stop-video", "host-start-video",
                "host-mute-all", "host-unmute-all",
                "host-stop-all-video", "host-start-all-video",
                "host-kick-user"
            ]:
                # Legitimate room host or appointed co-hosts can perform host actions
                is_auth = (room.get("host_peer_id") == peer_id) or (peer_id in room.get("co_hosts", set()))
                if not is_auth:
                    logger.warning(f"Unauthorized host action {msg_type} from {peer_id} rejected.")
                    continue

            if msg_type == "host-kick-user" and target_peer_id:
                target_peer = room["peers"].get(target_peer_id)
                if target_peer:
                    target_name = target_peer.get("name", "Participant")
                    try:
                        await target_peer["ws"].send_json({
                            "type": "host-kick-user",
                            "senderPeerId": peer_id,
                            "senderName": participant_name
                        })
                        await target_peer["ws"].close(code=1000)
                    except Exception as kick_err:
                        logger.error(f"Error disconnecting kicked peer: {kick_err}")
                    if target_peer_id in room["peers"]:
                        del room["peers"][target_peer_id]
                    if "locked_peers" in room:
                        room["locked_peers"].discard(target_peer_id)
                    if "co_hosts" in room:
                        room["co_hosts"].discard(target_peer_id)
                    # Broadcast peer-left immediately to all remaining peers
                    for pid, pinfo in list(room["peers"].items()):
                        try:
                            await pinfo["ws"].send_json({
                                "type": "peer-left",
                                "peerId": target_peer_id,
                                "name": target_name
                            })
                        except Exception:
                            pass
                continue

            if msg_type == "host-assign-cohost":
                host_pid = room.get("host_peer_id")
                # ONLY the primary host can assign or revoke co-hosts
                if host_pid != peer_id:
                    logger.warning(f"Unauthorized host-assign-cohost from non-primary host {peer_id}")
                    continue
                target_pid = data.get("targetPeerId")
                is_cohost = bool(data.get("isCoHost", True))
                if "co_hosts" not in room:
                    room["co_hosts"] = set()
                if is_cohost:
                    room["co_hosts"].add(target_pid)
                else:
                    room["co_hosts"].discard(target_pid)
                target_name = room.get("peers", {}).get(target_pid, {}).get("name", "Participant")
                logger.info(f"Primary host [{participant_name}] set Co-Host for [{target_name}] ({target_pid}) to: {is_cohost}")
                for pid, pinfo in list(room["peers"].items()):
                    try:
                        await pinfo["ws"].send_json({
                            "type": "cohost-updated",
                            "targetPeerId": target_pid,
                            "targetName": target_name,
                            "isCoHost": is_cohost,
                            "by": participant_name
                        })
                    except Exception:
                        pass
                continue

            if msg_type == "whiteboard-draw":
                stroke = data.get("stroke")
                if stroke:
                    if "whiteboard_strokes" not in room:
                        room["whiteboard_strokes"] = []
                    room["whiteboard_strokes"].append(stroke)
                    if len(room["whiteboard_strokes"]) > 1500:
                        room["whiteboard_strokes"].pop(0)
                for pid, pinfo in list(room["peers"].items()):
                    if pid != peer_id:
                        try:
                            await pinfo["ws"].send_json({
                                "type": "whiteboard-draw",
                                "stroke": stroke,
                                "senderPeerId": peer_id,
                                "senderName": participant_name
                            })
                        except Exception:
                            pass
                continue

            if msg_type == "whiteboard-clear":
                room["whiteboard_strokes"] = []
                for pid, pinfo in list(room["peers"].items()):
                    if pid != peer_id:
                        try:
                            await pinfo["ws"].send_json({
                                "type": "whiteboard-clear",
                                "by": participant_name
                            })
                        except Exception:
                            pass
                continue

            if msg_type == "whiteboard-request-sync":
                try:
                    await websocket.send_json({
                        "type": "whiteboard-sync",
                        "strokes": room.get("whiteboard_strokes", [])
                    })
                except Exception:
                    pass
                continue

            if msg_type == "host-end-meeting":
                if room.get("host_peer_id") == peer_id:
                    logger.info(f"Host [{participant_name}] ({peer_id}) executed 'End Meeting for All' for [{clean_room_id}]. Permanently invalidating room & tokens.")
                    now_ts = time.time()
                    EXPIRED_ROOMS[clean_room_id] = {
                        "expired_at": now_ts,
                        "reason": "HOST_TERMINATED",
                        "by": participant_name
                    }
                    # Also invalidate scheduled meeting if matching
                    for scode in list(SCHEDULED_MEETINGS.keys()):
                        if hashlib.sha256(scode.encode("utf-8")).hexdigest()[:16] == clean_room_id or scode == clean_room_id:
                            SCHEDULED_MEETINGS.pop(scode, None)
                            EXPIRED_ROOMS[scode] = {"expired_at": now_ts, "reason": "HOST_TERMINATED"}

                    # Broadcast termination notice to all participants
                    for pid, pinfo in list(room["peers"].items()):
                        try:
                            await pinfo["ws"].send_json({
                                "type": "meeting-ended",
                                "reason": "HOST_TERMINATED",
                                "by": participant_name,
                                "message": "The host has ended this meeting for all participants. Ephemeral meeting tokens and invitation links are permanently destroyed."
                            })
                            await pinfo["ws"].close(code=1000)
                        except Exception:
                            pass

                    # Deny all waiting peers
                    for wpid, winfo in list(room.get("waiting_peers", {}).items()):
                        try:
                            winfo["denied"] = True
                            winfo["event"].set()
                            await winfo["ws"].send_json({
                                "type": "meeting-ended",
                                "reason": "HOST_TERMINATED",
                                "message": "The host ended this meeting before admitting participants."
                            })
                            await winfo["ws"].close(code=1000)
                        except Exception:
                            pass

                    if clean_room_id in ROOMS:
                        del ROOMS[clean_room_id]
                    break
                else:
                    logger.warning(f"Unauthorized end-meeting action from non-host {peer_id} rejected.")
                continue

            if target_peer_id:
                # Targeted peer-to-peer signaling (Offer, Answer, Candidate, Host actions)
                target_peer = room["peers"].get(target_peer_id)
                if target_peer:
                    try:
                        await asyncio.wait_for(target_peer["ws"].send_text(json.dumps(data)), timeout=2.0)
                    except Exception as send_err:
                        logger.error(f"Error sending {msg_type} from {peer_id} to {target_peer_id}: {send_err}")
            else:
                # Broadcast message (Reactions, Raise Hand, Chat Meta, Mute updates)
                for pid, pinfo in list(room["peers"].items()):
                    if pid != peer_id:
                        try:
                            await asyncio.wait_for(pinfo["ws"].send_text(json.dumps(data)), timeout=2.0)
                        except Exception as send_err:
                            logger.error(f"Error broadcasting {msg_type} from {peer_id}: {send_err}")

    except WebSocketDisconnect:
        logger.info(f"Peer [{participant_name}] ({peer_id}) disconnected from room [{clean_room_id}]")
    except Exception as exc:
        logger.error(f"Unexpected websocket error for [{peer_id}]: {exc}")
    finally:
        if clean_room_id in ROOMS:
            if peer_id in ROOMS[clean_room_id]["peers"]:
                del ROOMS[clean_room_id]["peers"][peer_id]
            if "locked_peers" in ROOMS[clean_room_id]:
                ROOMS[clean_room_id]["locked_peers"].discard(peer_id)

            remaining_peers = ROOMS[clean_room_id]["peers"]
            host_left = False
            # If the original host left, NO ONE is promoted to host!
            if ROOMS[clean_room_id].get("host_peer_id") == peer_id:
                ROOMS[clean_room_id]["host_peer_id"] = None
                host_left = True
                logger.info(f"Original Host [{participant_name}] left room [{clean_room_id}]. No one is promoted to host.")
                # Deny any pending waiting peers as host is gone
                if "waiting_peers" in ROOMS[clean_room_id]:
                    for wpid, winfo in list(ROOMS[clean_room_id]["waiting_peers"].items()):
                        winfo["denied"] = True
                        winfo["event"].set()
                    ROOMS[clean_room_id]["waiting_peers"] = {}

            # Broadcast peer-left to all remaining participants
            for pid, pinfo in list(remaining_peers.items()):
                try:
                    await pinfo["ws"].send_json({
                        "type": "peer-left",
                        "peerId": peer_id,
                        "name": participant_name
                    })
                    if host_left:
                        # Inform all remaining participants that there is currently no host
                        await pinfo["ws"].send_json({
                            "type": "host-changed",
                            "newHostPeerId": None,
                            "newHostName": None
                        })
                except Exception:
                    pass

            # Ephemeral destruction: delete room immediately when empty and invalidate tokens
            if not remaining_peers:
                del ROOMS[clean_room_id]
                EXPIRED_ROOMS[clean_room_id] = {
                    "expired_at": time.time(),
                    "reason": "ROOM_CONCLUDED"
                }
                logger.info(f"Room [{clean_room_id}] concluded and destroyed. Marked permanently expired in EXPIRED_ROOMS (Zero residual token reuse allowed).")

# Mount frontend build if available
if os.path.exists(FRONTEND_DIST):
    logger.info(f"Mounting frontend dist from: {FRONTEND_DIST}")
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8000, log_level="info")
