"""
Socket.IO WebSocket server for real-time updates.
Handles: referral stats, wallet balance, task updates, notifications.
"""
import socketio
from typing import Dict, Set

# Create Socket.IO server
sio = socketio.AsyncServer(
    async_mode='asgi',
    cors_allowed_origins='*',
    logger=False,
    engineio_logger=False
)

# Track connected users: {user_id: {sid1, sid2, ...}}
connected_users: Dict[int, Set[str]] = {}


@sio.event
async def connect(sid, environ, auth):
    """Client connected."""
    print(f"Client connected: {sid}")


@sio.event
async def authenticate(sid, data):
    """Authenticate user and join their room."""
    user_id = data.get('user_id')
    if not user_id:
        await sio.disconnect(sid)
        return
    
    # Join user-specific room
    await sio.enter_room(sid, f"user_{user_id}")
    
    # Track connection
    if user_id not in connected_users:
        connected_users[user_id] = set()
    connected_users[user_id].add(sid)
    
    print(f"User {user_id} authenticated (sid: {sid})")


@sio.event
async def disconnect(sid):
    """Client disconnected."""
    # Remove from tracking
    for user_id, sids in list(connected_users.items()):
        if sid in sids:
            sids.remove(sid)
            if not sids:
                del connected_users[user_id]
            print(f"User {user_id} disconnected (sid: {sid})")
            break
    print(f"Client disconnected: {sid}")


# Emission helpers
async def emit_to_user(user_id: int, event: str, data: dict):
    """Emit event to specific user (all their connections)."""
    await sio.emit(event, data, room=f"user_{user_id}")


async def emit_referral_update(user_id: int, stats: dict):
    """Emit referral stats update."""
    await emit_to_user(user_id, 'referral:update', stats)


async def emit_wallet_update(user_id: int, balance: int):
    """Emit wallet balance update."""
    await emit_to_user(user_id, 'wallet:update', {'balance': balance})


async def emit_task_update(user_id: int, task_id: int, status: str):
    """Emit task status update."""
    await emit_to_user(user_id, 'task:update', {'task_id': task_id, 'status': status})


async def emit_notification(user_id: int, notification: dict):
    """Emit in-app notification."""
    await emit_to_user(user_id, 'notification', notification)
