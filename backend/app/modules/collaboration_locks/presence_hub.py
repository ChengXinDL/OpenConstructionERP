# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""In-memory pub/sub for the collaboration-locks WebSocket.

Each client subscribes with a ``(entity_type, entity_id)`` key plus its
own user identity.  When the service layer publishes a lock event, the
router looks up every socket subscribed to the same key and broadcasts
a JSON envelope.

Design choices
--------------

* **Pure asyncio / stdlib.**  No Redis, no Celery, no message broker.
  Single-worker deployments get full real-time fan-out; multi-worker
  deployments get DB-serialised locks (still correct) but presence
  events are worker-local.  The v2 plan upgrades this to Postgres
  ``LISTEN/NOTIFY`` without touching callers.

* **Per-key lock, not a single global lock.**  The hub is
  write-heavy on a handful of entities during an active session, so
  we keep a small ``asyncio.Lock`` per key and avoid serialising
  unrelated subscribers.

* **Dead-socket scrub on every broadcast.**  If a client tab is
  closed without a graceful close frame, ``send_json`` raises; we
  catch it and quietly drop the socket from the key set so a handful
  of stale tabs cannot leak memory.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass, field
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)

PresenceKey = tuple[str, uuid.UUID]


@dataclass
class _KeyState:
    """Per-entity state kept by the hub."""

    sockets: set[WebSocket] = field(default_factory=set)
    # user_id -> display name, deduped across open tabs
    users: dict[uuid.UUID, str] = field(default_factory=dict)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class PresenceHub:
    """Subscribe / broadcast / disconnect for presence WebSockets."""

    def __init__(self) -> None:
        self._keys: dict[PresenceKey, _KeyState] = {}
        self._map_lock = asyncio.Lock()

    async def _get_state(self, key: PresenceKey) -> _KeyState:
        async with self._map_lock:
            state = self._keys.get(key)
            if state is None:
                state = _KeyState()
                self._keys[key] = state
            return state

    async def join(
        self,
        key: PresenceKey,
        ws: WebSocket,
        *,
        user_id: uuid.UUID,
        user_name: str,
    ) -> list[dict[str, str]]:
        """Register ``ws`` under ``key``.

        Returns the full roster of users currently subscribed to the
        same key (including the joiner) so the client can paint the
        presence UI on its first render without a second round-trip.
        """
        state = await self._get_state(key)
        async with state.lock:
            state.sockets.add(ws)
            state.users[user_id] = user_name
            roster = [{"user_id": str(uid), "user_name": name} for uid, name in state.users.items()]
        return roster

    async def leave(self, key: PresenceKey, ws: WebSocket) -> list[uuid.UUID]:
        """Drop ``ws`` from ``key`` and return every user id that left.

        A user "left" once they have no remaining socket on this key, so a
        second tab still open means no departure.  Callers broadcast one
        ``presence_leave`` per returned id to the rest of the room.

        Returns a list, not a single id: more than one user can stop being
        accounted for on a single disconnect, and returning only one of them
        left the others visible in every peer's UI forever.  Order follows the
        roster, so the result is deterministic.
        """
        state = self._keys.get(key)
        if state is None:
            return []
        async with state.lock:
            state.sockets.discard(ws)
            if not state.sockets:
                # The room is empty: everyone still on the roster has left,
                # not merely the first of them.
                departed = list(state.users)
                state.users.clear()
                # Clean up the empty key so memory does not grow
                # unbounded as users browse across many entities.
                async with self._map_lock:
                    self._keys.pop(key, None)
                return departed

            # Check whether the departing socket belonged to a user
            # who no longer has any other open tab on this entity.
            #
            # We do not have a socket->user mapping here, so we walk
            # the rest of the sockets once to figure out who remains.
            # Small sets → cheap.
            remaining_uids: set[uuid.UUID] = set()
            for other_ws in state.sockets:
                uid = getattr(other_ws, "_collab_lock_user_id", None)
                if isinstance(uid, uuid.UUID):
                    remaining_uids.add(uid)
            departed = [uid for uid in state.users if uid not in remaining_uids]
            for uid in departed:
                state.users.pop(uid, None)
            return departed

    async def broadcast(
        self,
        key: PresenceKey,
        event: dict[str, Any],
        *,
        exclude: WebSocket | None = None,
    ) -> int:
        """Send ``event`` as JSON to every socket subscribed to
        ``key``.  Returns the number of successful sends.  Dead
        sockets are scrubbed in-place.
        """
        state = self._keys.get(key)
        if state is None:
            return 0

        async with state.lock:
            targets = list(state.sockets)

        sent = 0
        dead: list[WebSocket] = []
        for ws in targets:
            if ws is exclude:
                continue
            try:
                await ws.send_json(event)
                sent += 1
            except Exception:
                dead.append(ws)

        if dead:
            async with state.lock:
                for ws in dead:
                    state.sockets.discard(ws)
                if not state.sockets:
                    async with self._map_lock:
                        self._keys.pop(key, None)
        return sent

    # ── Diagnostics (used by tests) ─────────────────────────────────

    def subscriber_count(self, key: PresenceKey) -> int:
        state = self._keys.get(key)
        return 0 if state is None else len(state.sockets)

    def roster(self, key: PresenceKey) -> list[dict[str, str]]:
        """Read-only snapshot of the users connected to ``key``.

        Returns the same ``[{"user_id", "user_name"}]`` shape :meth:`join`
        hands back. A plain dict read (no lock) so a REST presence endpoint can
        report who is in a room without altering the hub's locking model; an
        in-flight join/leave just lands on the next call.
        """
        state = self._keys.get(key)
        if state is None:
            return []
        return [{"user_id": str(uid), "user_name": name} for uid, name in state.users.items()]

    def reset(self) -> None:
        """Drop every subscriber.  Used by test teardown."""
        self._keys.clear()


# Module-level singleton.  Each worker process has its own instance;
# see the file docstring for the multi-worker caveat.
presence_hub = PresenceHub()
