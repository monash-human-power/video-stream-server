const remoteVideo = document.getElementById('remoteVideo');
const statusText = document.getElementById('status');
const statsText = document.getElementById('stats');
const errorText = document.getElementById('error');

let peerConnection = null;
let resourceUrl = null;
let statsTimer = null;
let retryTimer = null;

let previousBytesReceived = 0;
let previousStatsTime = 0;

function updateStatus(status) {
  statusText.textContent = status;
}

function waitForIceGatheringComplete(connection) {
  if (connection.iceGatheringState === 'complete') {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    function checkState() {
      if (connection.iceGatheringState === 'complete') {
        connection.removeEventListener(
          'icegatheringstatechange',
          checkState
        );

        resolve();
      }
    }

    connection.addEventListener(
      'icegatheringstatechange',
      checkState
    );
  });
}

async function connectToStream() {
  clearTimeout(retryTimer);

  try {
    updateStatus('Connecting');
    errorText.textContent = '';

    const configResponse = await fetch('/api/stream-config');

    if (!configResponse.ok) {
      throw new Error('Could not load stream configuration');
    }

    const config = await configResponse.json();

    peerConnection = new RTCPeerConnection({
      iceServers: config.iceServers || [],
    });

    // Tell MediaMTX that this connection only receives video.
    peerConnection.addTransceiver('video', {
      direction: 'recvonly',
    });

    peerConnection.addEventListener('track', (event) => {
      if (event.streams && event.streams[0]) {
        remoteVideo.srcObject = event.streams[0];
      } else {
        remoteVideo.srcObject =
          new MediaStream([event.track]);
      }
    });

    peerConnection.addEventListener(
      'connectionstatechange',
      handleConnectionState
    );

    const offer = await peerConnection.createOffer();

    await peerConnection.setLocalDescription(offer);

    await waitForIceGatheringComplete(peerConnection);

    const whepResponse = await fetch(config.whepUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/sdp',
      },
      body: peerConnection.localDescription.sdp,
    });

    // A 404 normally means the phone is not publishing yet.
    if (whepResponse.status === 404) {
      await closeConnection();

      updateStatus('Waiting for phone');

      retryTimer = setTimeout(connectToStream, 3000);
      return;
    }

    if (!whepResponse.ok) {
      throw new Error(
        `WHEP request failed with status ${whepResponse.status}`
      );
    }

    const answerSdp = await whepResponse.text();

    await peerConnection.setRemoteDescription({
      type: 'answer',
      sdp: answerSdp,
    });

    const locationHeader =
      whepResponse.headers.get('Location');

    if (locationHeader) {
      resourceUrl = new URL(
        locationHeader,
        config.whepUrl
      ).toString();
    }

    updateStatus('Connected');

    statsTimer = setInterval(
      collectDashboardStats,
      2000
    );
  } catch (error) {
    console.error(error);

    errorText.textContent = error.message;

    await closeConnection();

    updateStatus('Reconnecting');

    retryTimer = setTimeout(connectToStream, 3000);
  }
}

function handleConnectionState() {
  if (!peerConnection) {
    return;
  }

  const state = peerConnection.connectionState;

  updateStatus(state);

  if (
    state === 'failed' ||
    state === 'disconnected' ||
    state === 'closed'
  ) {
    closeConnection().then(() => {
      updateStatus('Reconnecting');

      retryTimer = setTimeout(connectToStream, 3000);
    });
  }
}

async function collectDashboardStats() {
  if (!peerConnection) {
    return;
  }

  const reports = await peerConnection.getStats();

  let fps = 0;
  let bitrateKbps = 0;
  let packetsLost = 0;
  let framesDropped = 0;

  reports.forEach((report) => {
    if (
      report.type === 'inbound-rtp' &&
      report.kind === 'video'
    ) {
      fps = report.framesPerSecond || 0;
      packetsLost = report.packetsLost || 0;
      framesDropped = report.framesDropped || 0;

      const currentTime = report.timestamp;
      const currentBytes = report.bytesReceived || 0;

      if (previousStatsTime > 0) {
        const seconds =
          (currentTime - previousStatsTime) / 1000;

        const bytes =
          currentBytes - previousBytesReceived;

        if (seconds > 0) {
          bitrateKbps =
            Math.round((bytes * 8) / seconds / 1000);
        }
      }

      previousBytesReceived = currentBytes;
      previousStatsTime = currentTime;
    }
  });

  statsText.textContent =
    `FPS: ${fps} | Bitrate: ${bitrateKbps} kbps`;

  fetch('/api/stats', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      device: 'dashboard',
      fps,
      bitrateKbps,
      packetsLost,
      framesDropped,
      connectionState: peerConnection.connectionState,
    }),
  }).catch((error) => {
    console.warn('Could not send statistics:', error);
  });
}

async function closeConnection() {
  if (statsTimer) {
    clearInterval(statsTimer);
    statsTimer = null;
  }

  if (resourceUrl) {
    try {
      await fetch(resourceUrl, {
        method: 'DELETE',
      });
    } catch (error) {
      console.warn('Could not delete WHEP session:', error);
    }

    resourceUrl = null;
  }

  if (peerConnection) {
    peerConnection.removeEventListener(
      'connectionstatechange',
      handleConnectionState
    );

    peerConnection.close();
    peerConnection = null;
  }

  remoteVideo.srcObject = null;

  previousBytesReceived = 0;
  previousStatsTime = 0;
}

// Listen for live status and statistics from Node.
const events = new EventSource('/api/events');

events.addEventListener('status', (event) => {
  const data = JSON.parse(event.data);

  console.log('Status event:', data);
});

events.addEventListener('stats', (event) => {
  const data = JSON.parse(event.data);

  console.log('Statistics event:', data);
});

window.addEventListener('beforeunload', () => {
  clearTimeout(retryTimer);
  closeConnection();
});

connectToStream();