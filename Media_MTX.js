const express = require('express');  // to set up a web server
const cors = require('cors');        // controls which different web origins are allowed to make requests to Node Server
const path = require('path');        // helps construct file safely
const { spawn } = require('child_process');     // this is how Node Server starts Media MTX

const app = express();    // creates server application

const PORT = process.env.PORT || 3001;   // use port 3001 if it doesnt exist

const MEDIAMTX_URL =
  process.env.MEDIAMTX_URL || 'http://localhost:8889';

const STREAM_PATH =
  process.env.STREAM_PATH || 'bike-camera';

const MEDIAMTX_BIN =
  process.env.MEDIAMTX_BIN || '/opt/mediamtx/mediamtx';

const MEDIAMTX_CONF =
  process.env.MEDIAMTX_CONF || '/opt/mediamtx/mediamtx.yml';

// Set this to false if MediaMTX is being run separately on another machine.
const MANAGE_MEDIAMTX =
  process.env.MANAGE_MEDIAMTX !== 'false';


// =========================================================
// EXPRESS SETUP
// =========================================================

app.use(cors());
app.use(express.json());
app.use(
  express.static(
    path.join(__dirname, 'public')
  )
);


// =========================================================
// STORED STATUS AND STATISTICS
// =========================================================

const latestStats = {
  phone: null,
  dashboard: null,
};

const latestStatus = {
  phone: null,
  dashboard: null,
};


// Used to compare cumulative packet-loss values
// between statistics updates.
const previousPacketLoss = {
  phone: null,
  dashboard: null,
};


// =========================================================
// SERVER-SENT EVENTS
// =========================================================

const eventClients = new Set();


function sendEvent(eventName, data) {
  const message =
    `event: ${eventName}\n` +
    `data: ${JSON.stringify(data)}\n\n`;

  for (const client of eventClients) {
    if (client.writableEnded) {
      eventClients.delete(client);
      continue;
    }

    try {
      client.write(message);
    } catch (error) {
      console.warn(
        'Could not send SSE event:',
        error.message
      );

      eventClients.delete(client);
    }
  }
}


// =========================================================
// MEDIAMTX PROCESS MANAGEMENT
// =========================================================

let mediamtxProcess = null;
let mediamtxRunning = false;

let restartTimer = null;
let restartDelay = 1000;

let stableTimer = null;

let shuttingDown = false;


function scheduleMediaMTXRestart() {
  if (
    !MANAGE_MEDIAMTX ||
    shuttingDown ||
    restartTimer
  ) {
    return;
  }

  console.log(
    `MediaMTX will restart in ${restartDelay} ms...`
  );

  restartTimer = setTimeout(() => {
    restartTimer = null;
    startMediaMTX();
  }, restartDelay);

  // Exponential backoff:
  // 1s → 2s → 4s → 8s → ... → 30s
  restartDelay = Math.min(
    restartDelay * 2,
    30000
  );
}


function startMediaMTX() {
  if (
    !MANAGE_MEDIAMTX ||
    shuttingDown ||
    mediamtxProcess
  ) {
    return;
  }

  console.log(
    `Starting MediaMTX:\n` +
    `${MEDIAMTX_BIN} ${MEDIAMTX_CONF}`
  );

  const child = spawn(
    MEDIAMTX_BIN,
    [MEDIAMTX_CONF]
  );

  mediamtxProcess = child;
  mediamtxRunning = false;


  // -------------------------------------------------------
  // MediaMTX successfully started
  // -------------------------------------------------------

  child.once('spawn', () => {
    mediamtxRunning = true;

    console.log(
      'MediaMTX started successfully.'
    );

    // Only reset restart delay if MediaMTX
    // stays alive for at least 10 seconds.
    stableTimer = setTimeout(() => {
      restartDelay = 1000;
    }, 10000);
  });


  // -------------------------------------------------------
  // MediaMTX stdout
  // -------------------------------------------------------

  child.stdout.on('data', (data) => {
    process.stdout.write(
      `[mediamtx] ${data}`
    );
  });


  // -------------------------------------------------------
  // MediaMTX stderr
  // -------------------------------------------------------

  child.stderr.on('data', (data) => {
    process.stderr.write(
      `[mediamtx] ${data}`
    );
  });


  // -------------------------------------------------------
  // MediaMTX failed to start
  // -------------------------------------------------------

  child.once('error', (error) => {
    console.error(
      `Could not start MediaMTX: ${error.message}`
    );

    mediamtxRunning = false;

    if (mediamtxProcess === child) {
      mediamtxProcess = null;
    }

    if (stableTimer) {
      clearTimeout(stableTimer);
      stableTimer = null;
    }

    scheduleMediaMTXRestart();
  });


  // -------------------------------------------------------
  // MediaMTX exited
  // -------------------------------------------------------

  child.once('exit', (code, signal) => {
    console.log(
      `MediaMTX stopped ` +
      `(code ${code}, signal ${signal || 'none'}).`
    );

    mediamtxRunning = false;

    if (mediamtxProcess === child) {
      mediamtxProcess = null;
    }

    if (stableTimer) {
      clearTimeout(stableTimer);
      stableTimer = null;
    }

    scheduleMediaMTXRestart();
  });
}


if (MANAGE_MEDIAMTX) {
  startMediaMTX();
} else {
  console.log(
    'MediaMTX process management is disabled.'
  );

  console.log(
    'MediaMTX must already be running elsewhere.'
  );
}


// =========================================================
// HEALTH ENDPOINT
// =========================================================

app.get('/health', (req, res) => {
  res.json({
    status: 'online',

    protocol: 'WebRTC',

    mediaServer: 'MediaMTX',

    mediamtxManaged:
      MANAGE_MEDIAMTX,

    mediamtxRunning:
      MANAGE_MEDIAMTX
        ? mediamtxRunning
        : null,

    mediaMTXUrl:
      MEDIAMTX_URL,

    streamPath:
      STREAM_PATH,

    phoneStatus:
      latestStatus.phone,

    dashboardStatus:
      latestStatus.dashboard,
  });
});


// =========================================================
// STREAM CONFIGURATION
// =========================================================

app.get('/api/stream-config', (req, res) => {
  res.json({
    streamPath: STREAM_PATH,

    whipUrl:
      `${MEDIAMTX_URL}/${STREAM_PATH}/whip`,

    whepUrl:
      `${MEDIAMTX_URL}/${STREAM_PATH}/whep`,

    // A STUN server tells each device what its own address looks
    // like from outside its network (needed once phone and
    // dashboard aren't on the same WiFi — e.g. phone on cellular).
    // Without this, WebRTC only knows local/private IPs and the
    // connection will silently fail to establish off-WiFi.
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
    ],
  });
});


// =========================================================
// RECEIVE STATISTICS
// =========================================================

app.post('/api/stats', (req, res) => {
  const stats = req.body;


  // Make sure the device is valid.
  if (
    stats.device !== 'phone' &&
    stats.device !== 'dashboard'
  ) {
    return res.status(400).json({
      error:
        'Device must be phone or dashboard',
    });
  }


  const device = stats.device;


  // -------------------------------------------------------
  // Calculate NEW packet losses since the previous sample
  // -------------------------------------------------------
  //
  // packetsLost from WebRTC is generally cumulative.
  // So instead of checking:
  //
  //     packetsLost > 50
  //
  // we compare it with the previous value.
  //
  // Example:
  //
  // Previous: 20
  // Current:  23
  //
  // New losses = 3
  //
  // This prevents a warning just because the stream
  // has been running for a long time.
  // -------------------------------------------------------

  let packetsLostDelta = null;


  if (
    typeof stats.packetsLost === 'number'
  ) {

    const currentPacketsLost =
      Math.max(
        0,
        stats.packetsLost
      );


    if (
      previousPacketLoss[device] !== null
    ) {

      packetsLostDelta =
        Math.max(
          0,
          currentPacketsLost -
            previousPacketLoss[device]
        );

    }


    previousPacketLoss[device] =
      currentPacketsLost;
  }


  // -------------------------------------------------------
  // Store the statistics
  // -------------------------------------------------------

  latestStats[device] = {
    ...stats,

    packetsLostDelta,

    receivedAt:
      new Date().toISOString(),
  };


  // -------------------------------------------------------
  // Send statistics to connected SSE clients
  // -------------------------------------------------------

  sendEvent(
    'stats',
    latestStats[device]
  );


  res.json({
    message:
      'Statistics received',
  });
});


// =========================================================
// GET CURRENT STATISTICS
// =========================================================

app.get('/api/stats', (req, res) => {
  res.json(latestStats);
});


// =========================================================
// RECEIVE STATUS
// =========================================================

app.post('/api/status', (req, res) => {
  const statusUpdate = {
    ...req.body,

    receivedAt:
      new Date().toISOString(),
  };


  if (
    statusUpdate.device === 'phone' ||
    statusUpdate.device === 'dashboard'
  ) {

    latestStatus[
      statusUpdate.device
    ] = statusUpdate;

  }


  console.log(
    'Status update:',
    statusUpdate
  );


  sendEvent(
    'status',
    statusUpdate
  );


  res.json({
    message:
      'Status received',
  });
});


// =========================================================
// SERVER-SENT EVENTS ENDPOINT
// =========================================================

app.get('/api/events', (req, res) => {

  // Tell the browser this is an SSE connection.
  res.setHeader(
    'Content-Type',
    'text/event-stream'
  );

  res.setHeader(
    'Cache-Control',
    'no-cache, no-transform'
  );

  res.setHeader(
    'Connection',
    'keep-alive'
  );


  // Helps prevent proxy buffering.
  res.setHeader(
    'X-Accel-Buffering',
    'no'
  );


  res.flushHeaders();


  // Add this browser to our SSE clients.
  eventClients.add(res);


  console.log(
    `SSE client connected. ` +
    `Total clients: ${eventClients.size}`
  );


  // Send an initial event.
  res.write(
    `event: status\n` +
    `data: ${JSON.stringify({
      device: 'server',
      status: 'connected',
    })}\n\n`
  );


  // Keep connection alive.
  const keepAlive = setInterval(() => {

    if (!res.writableEnded) {
      res.write(': keep-alive\n\n');
    }

  }, 20000);


  // Remove client when browser disconnects.
  req.on('close', () => {

    clearInterval(keepAlive);

    eventClients.delete(res);

    console.log(
      `SSE client disconnected. ` +
      `Total clients: ${eventClients.size}`
    );

  });
});


// =========================================================
// SUPERVISE PHONE CONNECTION 
// =========================================================

setInterval(() => {

  const phoneStatus =
    latestStatus.phone;

  const phoneStats =
    latestStats.phone;


  // We cannot check the phone if we have never received any information from it.
  if (
    !phoneStatus ||
    !phoneStats
  ) {
    return;
  }


  // Only watch for stalls while the phone is supposed to be live.
  // Without this, a deliberate "Stop Stream" (status becomes
  // "disconnected") would still get picked up below once its old
  // stats go stale, and get permanently relabeled as "stalled"
  // instead of showing the intentional disconnect.
  if (
    phoneStatus.status !== 'connected' &&
    phoneStatus.status !== 'stalled'
  ) {
    return;
  }


  const secondsSinceLastStats =
    (
      Date.now() -
      new Date(
        phoneStats.receivedAt
      ).getTime()
    ) / 1000;


  // -------------------------------------------------------
  // NO STATS FOR MORE THAN 6 SECONDS
  // -------------------------------------------------------

  if (
    secondsSinceLastStats > 6 &&
    phoneStatus.status !== 'stalled'
  ) {

    const stalledStatus = {

      device: 'phone',

      status: 'stalled',

      receivedAt:
        new Date().toISOString(),

    };


    latestStatus.phone =
      stalledStatus;


    console.log(
      `Warning: no phone statistics ` +
      `received for ` +
      `${Math.round(secondsSinceLastStats)} seconds.`
    );


    sendEvent(
      'status',
      stalledStatus
    );
  }


  // -------------------------------------------------------
  // PHONE HAS RECOVERED
  // -------------------------------------------------------

  if (
    secondsSinceLastStats <= 6 &&
    phoneStatus.status === 'stalled'
  ) {

    const recoveredStatus = {

      device: 'phone',

      status: 'connected',

      receivedAt:
        new Date().toISOString(),

    };


    latestStatus.phone =
      recoveredStatus;


    console.log(
      'Phone statistics resumed.'
    );


    sendEvent(
      'status',
      recoveredStatus
    );
  }


  // -------------------------------------------------------
  // ZERO BITRATE
  // -------------------------------------------------------

  if (
    phoneStats.bitrateKbps === 0 &&
    secondsSinceLastStats <= 6
  ) {

    console.log(
      'Warning: phone is connected ' + 'but currently sending 0 kbps.'
    );


    sendEvent(
      'network-warning',
      {

        device: 'phone',

        type: 'zero-bitrate',

        message:
          'Phone is connected but currently sending 0 kbps.',

      }
    );
  }


  // -------------------------------------------------------
  // PACKET LOSS
  // -------------------------------------------------------
  //
  // Only look at newly lost packets during the latest
  // statistics interval.
  //
  // We do NOT use the cumulative total here.
  //
  // 10 is just a warning threshold.
  // -------------------------------------------------------

  if (
    typeof phoneStats.packetsLostDelta ===
      'number' &&
    phoneStats.packetsLostDelta >= 10
  ) {

    console.log(
      `Warning: ${phoneStats.packetsLostDelta} ` +
      `new packets were lost in the latest sample.`
    );


    sendEvent(
      'network-warning',
      {

        device: 'phone',

        type: 'packet-loss',

        packetsLost:
          phoneStats.packetsLostDelta,

        message:
          `${phoneStats.packetsLostDelta} ` +
          `new packets were lost in the latest sample.`,

      }
    );
  }


}, 3000);


// =========================================================
// START NODE SERVER
// =========================================================

const server = app.listen(
  PORT,'0.0.0.0',
  () => {

    console.log('');
    console.log(
      '========================================'
    );

    console.log(
      '       Bike Camera Streaming Server'
    );

    console.log(
      '========================================'
    );

    console.log('');

    console.log(
      `Node server: http://localhost:${PORT}`
    );

    console.log(
      `Phone page: http://localhost:${PORT}/phone.html`
    );

    console.log(
      `Dashboard: http://localhost:${PORT}/dashboard.html`
    );

    console.log('');

    console.log(
      `MediaMTX: ${MEDIAMTX_URL}`
    );

    console.log(
      `Stream path: ${STREAM_PATH}`
    );

    console.log(
      `WHIP: ${MEDIAMTX_URL}/${STREAM_PATH}/whip`
    );

    console.log(
      `WHEP: ${MEDIAMTX_URL}/${STREAM_PATH}/whep`
    );

    console.log('');
  }
);


// =========================================================
// SHUTDOWN
// =========================================================

function shutdown(signal) {

  if (shuttingDown) {
    return;
  }


  shuttingDown = true;


  console.log(
    `Received ${signal}. Shutting down...`
  );


  // Cancel a scheduled MediaMTX restart.
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }


  // Cancel stable-process timer.
  if (stableTimer) {
    clearTimeout(stableTimer);
    stableTimer = null;
  }


  // Stop MediaMTX if Node is managing it.
  if (mediamtxProcess) {

    console.log(
      'Stopping MediaMTX...'
    );

    mediamtxProcess.kill(
      'SIGTERM'
    );

    mediamtxProcess = null;
    mediamtxRunning = false;
  }


  // Close all SSE connections.
  for (const client of eventClients) {
    client.end();
  }

  eventClients.clear();


  // Close Node server.
  server.close(() => {

    console.log(
      'Node server stopped.'
    );

    process.exit(0);

  });
}


process.on(
  'SIGINT',
  () => shutdown('SIGINT')
);

process.on(
  'SIGTERM',
  () => shutdown('SIGTERM')
);
