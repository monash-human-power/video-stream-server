const localVideo = document.getElementById('localVideo');
const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
const statusText = document.getElementById('status');
const statsText = document.getElementById('stats');
const errorText = document.getElementById('error');

let peerConnection = null;
let localStream = null;
let resourceUrl = null;
let statsTimer = null;

let previousBytesSent = 0;
let previousStatsTime = 0;

startButton.addEventListener('click', startStreaming);
stopButton.addEventListener('click', stopStreaming);

function updateStatus(status) {
  statusText.textContent = status;

  fetch('/api/status', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      device: 'phone',
      status: status.toLowerCase(),
    }),
  }).catch((error) => {
    console.warn('Could not send status:', error);
  });
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

async function applyBitrateLimit(connection, maxBitrate) {
  const senders = connection.getSenders();

  const videoSender = senders.find((sender) => {
    return sender.track && sender.track.kind === 'video';
  });

  if (!videoSender) {
    return;
  }

  const parameters = videoSender.getParameters();

  if (!parameters.encodings) {
    parameters.encodings = [{}];
  }

  parameters.encodings[0].maxBitrate = maxBitrate;

  await videoSender.setParameters(parameters);
}

async function startStreaming() {
  startButton.disabled = true;
  errorText.textContent = '';

  try {
    updateStatus('Connecting');

    // Ask the Node server for MediaMTX connection details.
    const configResponse = await fetch('/api/stream-config');

    if (!configResponse.ok) {
      throw new Error('Could not load stream configuration');
    }

    const config = await configResponse.json();

    // Request the phone's rear camera.
    localStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: {
          ideal: 'environment',
        },
        width: {
          ideal: 1280,
        },
        height: {
          ideal: 720,
        },
        frameRate: {
          ideal: 30,
          max: 30,
        },
      },
      audio: false,
    });

    // Display the local camera preview.
    localVideo.srcObject = localStream;

    // Create the WebRTC connection.
    peerConnection = new RTCPeerConnection({
      iceServers: config.iceServers || [],
    });

    peerConnection.addEventListener(
      'connectionstatechange',
      handleConnectionState
    );

    // Add every camera track to the WebRTC connection.
    for (const track of localStream.getTracks()) {
      peerConnection.addTrack(track, localStream);
    }

    // Limit the video to 1.5 Mbps.
    await applyBitrateLimit(peerConnection, 1500000);

    // Create and store the SDP offer.
    const offer = await peerConnection.createOffer();

    await peerConnection.setLocalDescription(offer);

    // Use non-trickle ICE by waiting for gathering to finish.
    await waitForIceGatheringComplete(peerConnection);

    // Send the SDP offer to MediaMTX's WHIP endpoint.
    const whipResponse = await fetch(config.whipUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/sdp',
      },
      body: peerConnection.localDescription.sdp,
    });

    if (!whipResponse.ok) {
      throw new Error(
        `WHIP request failed with status ${whipResponse.status}`
      );
    }

    // MediaMTX returns the SDP answer in the response body.
    const answerSdp = await whipResponse.text();

    await peerConnection.setRemoteDescription({
      type: 'answer',
      sdp: answerSdp,
    });

    // Store the session URL used when stopping the stream.
    const locationHeader =
      whipResponse.headers.get('Location');

    if (locationHeader) {
      resourceUrl = new URL(
        locationHeader,
        config.whipUrl
      ).toString();
    }

    updateStatus('Connected');

    stopButton.disabled = false;

    statsTimer = setInterval(sendPhoneStats, 2000);
  } catch (error) {
    console.error(error);

    errorText.textContent = error.message;

    updateStatus('Failed');

    await stopStreaming();
  }
}

function handleConnectionState() {
  if (!peerConnection) {
    return;
  }

  const state = peerConnection.connectionState;

  updateStatus(state);

  if (state === 'failed' || state === 'closed') {
    stopStreaming();
  }
}

async function sendPhoneStats() {
  if (!peerConnection) {
    return;
  }

  const reports = await peerConnection.getStats();

  let fps = 0;
  let bitrateKbps = 0;
  let packetsLost = 0;

  reports.forEach((report) => {
    if (
      report.type === 'outbound-rtp' &&
      report.kind === 'video'
    ) {
      fps = report.framesPerSecond || 0;

      const currentTime = report.timestamp;
      const currentBytes = report.bytesSent || 0;

      if (previousStatsTime > 0) {
        const seconds =
          (currentTime - previousStatsTime) / 1000;

        const bytes =
          currentBytes - previousBytesSent;

        if (seconds > 0) {
          bitrateKbps =
            Math.round((bytes * 8) / seconds / 1000);
        }
      }

      previousBytesSent = currentBytes;
      previousStatsTime = currentTime;
    }

    if (report.type === 'remote-inbound-rtp') {
      packetsLost = report.packetsLost || 0;
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
      device: 'phone',
      fps,
      bitrateKbps,
      packetsLost,
      connectionState: peerConnection.connectionState,
    }),
  }).catch((error) => {
    console.warn('Could not send statistics:', error);
  });
}

async function stopStreaming() {
  if (statsTimer) {
    clearInterval(statsTimer);
    statsTimer = null;
  }

  // Ask MediaMTX to delete the WHIP session.
  if (resourceUrl) {
    try {
      await fetch(resourceUrl, {
        method: 'DELETE',
      });
    } catch (error) {
      console.warn('Could not delete WHIP session:', error);
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

  if (localStream) {
    for (const track of localStream.getTracks()) {
      track.stop();
    }

    localStream = null;
  }

  localVideo.srcObject = null;

  previousBytesSent = 0;
  previousStatsTime = 0;

  startButton.disabled = false;
  stopButton.disabled = true;

  updateStatus('Disconnected');
}