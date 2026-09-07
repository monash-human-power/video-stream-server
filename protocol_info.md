# Protocol Decision Framework

## Your Project Requirements
- [ ] Live video during race (need low latency < 500ms)
- [ ] Multiple dashboards viewing (need broadcast)
- [ ] Reliable streaming (network glitches expected)
- [ ] Works on mobile/web
- [ ] Firewall/NAT friendly

## Protocol Analysis

### WebSocket
**Latency:** 50-100ms ✅ (BEST)
**Complexity:** Medium (requires WebSocket library)
**Scalability:** Good (broadcast to many clients)
**Firewall Friendly:** Yes (HTTP upgrade)
**Browser Support:** Yes (native)

Pros:
- Lowest latency
- JavaScript native
- Persistent connection

Cons:
- Less "standard" for video
- Need custom frame format

Use when: You need <100ms latency, many dashboards, browser display

---

### RTSP
**Latency:** 200-500ms ⚠️
**Complexity:** Low (standard protocol)
**Scalability:** Medium (stateful per client)
**Firewall Friendly:** No (raw TCP, often blocked)
**Browser Support:** No (need player)

Pros:
- Industry standard
- Works everywhere
- Stateful (clients manage themselves)

Cons:
- Firewall issues
- Not web-native
- Higher latency

Use when: You want "standard" video protocol, don't care about latency

---

### RTMP
**Latency:** 1-3 seconds
**Complexity:** Medium
**Scalability:** Good (streaming)
**Firewall Friendly:** No (raw TCP)
**Browser Support:** No (legacy)

Pros:
- Well-understood
- Good for streaming

Cons:
- Deprecated by Adobe
- High latency
- Not web-native

Use when: Legacy requirements only

---

### HLS
**Latency:** 3-10 seconds
**Complexity:** Medium (FFmpeg required)
**Scalability:** Excellent (HTTP, CDN-friendly)
**Firewall Friendly:** Yes (HTTP)
**Browser Support:** Yes (native)

Pros:
- HTTP-based (CDN friendly)
- Adaptive bitrate
- Buffering (reliable)

Cons:
- High latency (not for live race)
- Complex setup (FFmpeg, segmenting)

Use when: You don't need live <1s latency, want reliability

---

### MediaMTX
**Latency:** Can be <100ms (protocol-dependent)
**Complexity:** Low (all protocols handled)
**Scalability:** Excellent (Swiss Army knife)
**Firewall Friendly:** Depends on protocol
**Browser Support:** Depends on protocol

Pros:
- Handles all protocols
- Flexible
- Simple to deploy

Cons:
- Overkill if you only need one
- Adds complexity (separate service)

Use when: You want flexibility, might need multiple clients/protocols

---

## DECISION CHECKLIST

[ ] Which protocol did you choose? _______

[ ] Why? (latency/simplicity/compatibility)
    _________________________________

[ ] What's your phone implementation?
    _________________________________

[ ] What's your dashboard implementation?
    _________________________________

[ ] Fallback protocol if first fails?
    _________________________________