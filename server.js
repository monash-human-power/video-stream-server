/**
 * This code imports libraries that we need to have:
 * 
 * express : helps us build a server
 * cors: let's us communicate with the dashboard. it explicityly 
 * gives the dashboard's servers to access our video and play. 
 * 
 */

const express = require('express');
const cors = require('cors');
const http = require('http');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const PORT = process.env.PORT || 3001;

// TODO: Design Decision #1 - CHOOSE YOUR PROTOCOL
// 
// Option A: WebSocket (low latency, complex)
// Option B: RTSP (standard, simpler, stateful)
// Option C: RTMP (legacy, Adobe)
// Option D: HLS (buffering, adaptive bitrate)
// Option E: MediaMTX (Swiss Army knife, all protocols)
//
// Each has different trade-offs below:
// Fill in which ONE you're using:

const PROTOCOL = process.env.PROTOCOL || 'WEBSOCKET'; // or 'RTSP', 'RTMP', 'HLS', 'MEDIAMTX'

// ============================================
// PROTOCOL A: WebSocket (Low Latency)
// ============================================
if (PROTOCOL === 'WEBSOCKET') {
  const WebSocket = require('ws');
  const wss = new WebSocket.Server({ server });

  const dashboardClients = new Set();

  wss.on('connection', (ws, req) => {
    const isPhone = req.url === '/phone-stream';
    const isDashboard = req.url === '/dashboard-stream';

    if (isPhone) {
      console.log('📱 Phone connected (WebSocket)');
      
      ws.on('message', (chunk) => {
        // TODO: Your frame handling here
        dashboardClients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(chunk);
          }
        });
      });

      ws.on('close', () => console.log('📱 Phone disconnected'));
    } 
    else if (isDashboard) {
      console.log('📊 Dashboard connected (WebSocket)');
      dashboardClients.add(ws);
      ws.on('close', () => dashboardClients.delete(ws));
    }
  });
}

// ============================================
// PROTOCOL B: RTSP (Standard, Stateful)
// ============================================
else if (PROTOCOL === 'RTSP') {
  // TODO: Implement RTSP server
  // Use library like: rtsp-server, rtsp-simple-server
  // 
  // RTSP Flow:
  // 1. Phone: SETUP (create session)
  // 2. Phone: RECORD (send video)
  // 3. Dashboard: PLAY (request stream)
  //
  // Pros: Industry standard, stateful, clients understand it
  // Cons: More complex, stateful connections, firewall issues
  //
  // Example with rtsp-simple-server:
  // const { spawn } = require('child_process');
  // spawn('rtsp-simple-server', ['rtsp-simple-server.yml']);
  
  console.log('RTSP server would run here (use rtsp-simple-server)');
}

// ============================================
// PROTOCOL C: RTMP (Legacy, Adobe)
// ============================================
else if (PROTOCOL === 'RTMP') {
  // TODO: Implement RTMP server
  // Use library like: rtmp-server, wrtc-rtmp
  //
  // RTMP Flow:
  // 1. Phone: CONNECT, CREATE STREAM
  // 2. Phone: PUBLISH (send video)
  // 3. Dashboard: SUBSCRIBE (watch stream)
  //
  // Pros: Legacy support, widely understood
  // Cons: Falling out of favor, Adobe deprecated it, complex protocol
  //
  // Note: Most dashboards moved away from RTMP
  
  console.log('RTMP server would run here');
}

// ============================================
// PROTOCOL D: HLS (HTTP Live Streaming)
// ============================================
else if (PROTOCOL === 'HLS') {
  // TODO: Implement HLS server
  // HLS = Break video into segments + manifest file
  //
  // Flow:
  // 1. Phone: Encode H.264 → break into 2-second chunks
  // 2. Server: Create .m3u8 playlist file
  // 3. Dashboard: Load playlist, stream chunks
  //
  // Pros: Works over HTTP, adaptive bitrate, buffering
  // Cons: Latency (buffering delay), complexity
  //
  // Library: hls-server, fluent-ffmpeg
  
  const hlsServer = require('hls-server');
  
  const hlsOptions = {
    // TODO: Your HLS configuration
    port: 3001,
    chunk_size: 10,        // seconds per chunk
    live: true,            // live stream vs VOD
  };
  
  console.log('HLS server configured');
}

// ============================================
// PROTOCOL E: MediaMTX (All-in-One)
// ============================================
else if (PROTOCOL === 'MEDIAMTX') {
  // TODO: Use MediaMTX for all protocols at once
  //
  // MediaMTX = Gateway that handles:
  // - RTSP input from phone
  // - Outputs to HLS, DASH, WebRTC, RTMP
  //
  // Flow:
  // 1. Phone: Publish RTSP to MediaMTX
  // 2. Dashboard: Connect via HLS/WebRTC/RTSP (choose one)
  //
  // Pros: One tool handles everything, flexible
  // Cons: Overkill if you only need one protocol
  //
  // Setup: Run MediaMTX separately, point to it
  
  const { spawn } = require('child_process');
  
  // MediaMTX config (would be in mediamtx.yml):
  // paths:
  //   all:
  //     runOnReady: ffmpeg -i rtsp://localhost:8554/video -c:v libx264 -c:a aac -f flv rtmp://...
  
  console.log('MediaMTX would run here');
}

// ============================================
// Generic Health Check
// ============================================
app.get('/health', (req, res) => {
  res.json({ 
    status: 'online', 
    protocol: PROTOCOL,
    // TODO: Add protocol-specific health info
  });
});

server.listen(PORT, () => {
  console.log(`🎥 Video server (${PROTOCOL}) running on http://localhost:${PORT}`);
  console.log(`   Protocol: ${PROTOCOL}`);
  console.log(`   Connection: See template for protocol-specific details`);
});