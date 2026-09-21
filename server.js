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
const path = require('path');

const app = express();

const PORT = process.env.PORT || 3001;

// Your partner can change this address when MediaMTX is ready.
const MEDIAMTX_URL =
  process.env.MEDIAMTX_URL || 'http://localhost:8889';

const STREAM_PATH =
  process.env.STREAM_PATH || 'bike-camera';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Stores the latest statistics from the phone and dashboard.
const latestStats = {
  phone: null,
  dashboard: null,
};

// Stores open SSE connections.
const eventClients = new Set();

function sendEvent(eventName, data) {
  const message =
    `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;

  for (const client of eventClients) {
    client.write(message);
  }
}

// Basic server test.
app.get('/health', (req, res) => {
  res.json({
    status: 'online',
    protocol: 'WebRTC',
    mediaServer: 'MediaMTX',
    streamPath: STREAM_PATH,
  });
});

// Gives the WHIP and WHEP URLs to the browser.
app.get('/api/stream-config', (req, res) => {
  res.json({
    streamPath: STREAM_PATH,
    whipUrl: `${MEDIAMTX_URL}/${STREAM_PATH}/whip`,
    whepUrl: `${MEDIAMTX_URL}/${STREAM_PATH}/whep`,
    iceServers: [],
  });
});

// Receives statistics from phone.js and dashboard.js.
app.post('/api/stats', (req, res) => {
  const stats = req.body;

  if (stats.device !== 'phone' && stats.device !== 'dashboard') {
    return res.status(400).json({
      error: 'Device must be phone or dashboard',
    });
  }

  latestStats[stats.device] = {
    ...stats,
    receivedAt: new Date().toISOString(),
  };

  sendEvent('stats', latestStats[stats.device]);

  res.json({
    message: 'Statistics received',
  });
});

// Returns the latest stored statistics.
app.get('/api/stats', (req, res) => {
  res.json(latestStats);
});

// Receives phone and dashboard connection updates.
app.post('/api/status', (req, res) => {
  const statusUpdate = {
    ...req.body,
    receivedAt: new Date().toISOString(),
  };

  console.log('Status update:', statusUpdate);

  sendEvent('status', statusUpdate);

  res.json({
    message: 'Status received',
  });
});

// Opens an SSE connection for dashboard updates.
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  res.flushHeaders();

  eventClients.add(res);

  res.write(
    `event: status\ndata: ${JSON.stringify({
      device: 'server',
      status: 'connected',
    })}\n\n`
  );

  const keepAlive = setInterval(() => {
    res.write(': keep-alive\n\n');
  }, 20000);

  req.on('close', () => {
    clearInterval(keepAlive);
    eventClients.delete(res);
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Node server: http://localhost:${PORT}`);
  console.log(`Phone page: http://localhost:${PORT}/phone.html`);
  console.log(`Dashboard: http://localhost:${PORT}/dashboard.html`);
  console.log(
    `WHIP: ${MEDIAMTX_URL}/${STREAM_PATH}/whip`
  );
  console.log(
    `WHEP: ${MEDIAMTX_URL}/${STREAM_PATH}/whep`
  );
});