// One realtime room per event id (sprint, circuit, ...), as a hibernating Durable Object.
//
// Joining: the Worker has already checked the Origin header and the player token (see index.js), and
// forwards the cleaned profile in the URL query. The room assigns each connection a small sender
// index (0..255), stores the profile in the connection attachment (so the roster survives
// hibernation), sends the newcomer the roster and tells everyone else.
//
// Realtime: binary state packets (src/net/protocol.js) are relayed to everyone else prefixed with the
// sender index. Text frames are JSON control messages.
//
// Server -> client text messages:
//   {t:'roster', you, peers:[peer]}   on join; `you` is your own sender index
//   {t:'join', peer} / {t:'update', peer} / {t:'leave', i}
//   peer = {i, id, name, level, paint, rim, number}
// Client -> server text messages:
//   {t:'profile', name, level, paint, rim, number}
//
// Close codes: 4003 room full, 4008 sending too fast, 1009 frame too large, 4400 bad join params.

import { Server } from 'partyserver';
import { PACKET_SIZE, MAX_BINARY, MAX_TEXT } from '../../src/net/protocol.js';
import { MAX_ROOM_SIZE, parseJoinParams, sanitizeCosmetic, sanitizeLevel, sanitizeName } from './validate.js';

/** Token bucket: sustained 15 packets/s, bursts of 30. Running dry closes the socket. */
const RATE_PER_SECOND = 15;
const RATE_BURST = 30;

function peerOf(state) {
  return { i: state.i, id: state.id, name: state.name, level: state.level, paint: state.paint, rim: state.rim, number: state.number };
}

export class Room extends Server {
  static options = { hibernate: true };

  constructor(ctx, env) {
    super(ctx, env);
    /** connection id -> { tokens, at } — in memory only; resets harmlessly after hibernation. */
    this.buckets = new Map();
  }

  /** Live connections that finished joining (they carry a profile attachment). */
  members() {
    const list = [];
    for (const connection of this.getConnections()) {
      const state = connection.state;
      if (state && typeof state.i === 'number') list.push(connection);
    }
    return list;
  }

  onConnect(connection, ctx) {
    const url = new URL(ctx.request.url);
    const params = parseJoinParams(url.searchParams);
    if (!params) {
      connection.send(JSON.stringify({ t: 'rejected' }));
      this.closeSoon(connection, 4400, 'bad join parameters');
      return;
    }
    const members = this.members().filter((member) => member.id !== connection.id);
    if (members.length >= MAX_ROOM_SIZE) {
      connection.send(JSON.stringify({ t: 'full', max: MAX_ROOM_SIZE }));
      this.closeSoon(connection, 4003, 'room full');
      return;
    }
    const used = new Set(members.map((member) => member.state.i));
    let index = 0;
    while (used.has(index) && index < 255) index += 1;

    const state = {
      i: index,
      id: params.playerId,
      name: params.name,
      level: params.level,
      paint: params.paint,
      rim: params.rim,
      number: params.number,
      joined: Date.now(),
    };
    connection.setState(state);
    this.buckets.set(connection.id, { tokens: RATE_BURST, at: Date.now() });

    connection.send(JSON.stringify({ t: 'roster', you: index, room: this.name, peers: members.map((member) => peerOf(member.state)) }));
    this.broadcast(JSON.stringify({ t: 'join', peer: peerOf(state) }), [connection.id]);
  }

  /**
   * Refuse a connection from onConnect. Closing immediately loses the close frame (seen in wrangler
   * dev), so the client is told why in a text message first and the close follows shortly after.
   */
  closeSoon(connection, code, reason) {
    setTimeout(() => {
      try {
        connection.close(code, reason);
      } catch {
        // the client already left (well-behaved clients close themselves on 'full' / 'rejected')
      }
    }, 500);
  }

  /** False when this connection has been sending faster than the sustained limit. */
  allow(connection) {
    const now = Date.now();
    let bucket = this.buckets.get(connection.id);
    if (!bucket) {
      bucket = { tokens: RATE_BURST, at: now };
      this.buckets.set(connection.id, bucket);
    }
    bucket.tokens = Math.min(RATE_BURST, bucket.tokens + ((now - bucket.at) / 1000) * RATE_PER_SECOND);
    bucket.at = now;
    bucket.tokens -= 1;
    return bucket.tokens >= 0;
  }

  onMessage(connection, message) {
    const state = connection.state;
    if (!state || typeof state.i !== 'number') return;
    if (!this.allow(connection)) {
      this.kick(connection, 4008, 'sending too fast');
      return;
    }

    if (typeof message === 'string') {
      if (message.length > MAX_TEXT) {
        this.kick(connection, 1009, 'message too large');
        return;
      }
      let data;
      try {
        data = JSON.parse(message);
      } catch {
        return;
      }
      if (data && data.t === 'profile') {
        const next = {
          ...state,
          name: sanitizeName(data.name) || state.name,
          level: data.level == null ? state.level : sanitizeLevel(data.level),
          paint: data.paint == null ? state.paint : sanitizeCosmetic(data.paint) || state.paint,
          rim: data.rim == null ? state.rim : sanitizeCosmetic(data.rim) || state.rim,
          number: data.number == null ? state.number : sanitizeCosmetic(data.number, 'number'),
        };
        connection.setState(next);
        this.broadcast(JSON.stringify({ t: 'update', peer: peerOf(next) }), [connection.id]);
      }
      return;
    }

    const bytes = message instanceof ArrayBuffer ? new Uint8Array(message) : ArrayBuffer.isView(message) ? new Uint8Array(message.buffer, message.byteOffset, message.byteLength) : null;
    if (!bytes) return;
    if (bytes.byteLength > MAX_BINARY) {
      this.kick(connection, 1009, 'packet too large');
      return;
    }
    if (bytes.byteLength !== PACKET_SIZE) return; // wrong version or garbage: drop silently
    const relay = new Uint8Array(PACKET_SIZE + 1);
    relay[0] = state.i;
    relay.set(bytes, 1);
    this.broadcast(relay, [connection.id]);
  }

  /** Server-side disconnect: tell the others now rather than waiting for the close handshake. */
  kick(connection, code, reason) {
    this.onClose(connection);
    connection.setState(null);
    try {
      connection.close(code, reason);
    } catch {
      // already closing
    }
  }

  onClose(connection) {
    this.buckets.delete(connection.id);
    const state = connection.state;
    if (state && typeof state.i === 'number') {
      this.broadcast(JSON.stringify({ t: 'leave', i: state.i, id: state.id }), [connection.id]);
    }
  }

  onError(connection) {
    this.buckets.delete(connection.id);
  }

  /** GET from the Worker (via getServerByName) -> { count }. */
  onRequest() {
    return Response.json({ count: this.members().length });
  }
}
