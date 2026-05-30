/* ═══════════════════════════════════════════════════════════
   GLOBALCHAT · Client
   - Socket.io signaling
   - Full-mesh WebRTC (every peer connects to every other peer)
   - Chat
   - Camera / mic toggle
═══════════════════════════════════════════════════════════ */

/* ── ICE server config (uses Google STUN + multiple fallbacks) ── */
const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.services.mozilla.com' },
  ]
};

/* ── State ───────────────────────────────────────────────────── */
let socket;
let localStream = null;
let mySocketId  = null;
let myName      = '';

const peers   = new Map(); // socketId → RTCPeerConnection
const peerNames = new Map(); // socketId → name

/* ── DOM refs ────────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);
const joinScreen  = $('join-screen');
const roomScreen  = $('room-screen');
const nameInput   = $('name-input');
const codeInput   = $('code-input');
const joinBtn     = $('join-btn');
const joinError   = $('join-error');
const videoGrid   = $('video-grid');
const peerCount   = $('peer-count');
const btnMic      = $('btn-mic');
const btnCam      = $('btn-cam');
const btnChat     = $('btn-chat');
const btnLeave    = $('btn-leave');
const chatPanel   = $('chat-panel');
const chatMessages= $('chat-messages');
const chatInput   = $('chat-input');
const chatSend    = $('chat-send');
const closeChat   = $('close-chat');
const chatBadge   = $('chat-badge');
const toastEl     = $('toast');
const toggleEye   = $('toggle-eye');

/* ── Helpers ─────────────────────────────────────────────────── */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
}

let toastTimer;
function showToast(msg, duration = 3000) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), duration);
}

function updatePeerCount() {
  const n = peers.size + 1; // +1 for self
  peerCount.textContent = `${n} participant${n !== 1 ? 's' : ''}`;
}

function initials(name) {
  return (name || '?')[0].toUpperCase();
}

/* ── Camera/Mic controls ─────────────────────────────────────── */
let micOn = true;
let camOn = true;

btnMic.addEventListener('click', () => {
  micOn = !micOn;
  localStream?.getAudioTracks().forEach(t => (t.enabled = micOn));
  btnMic.classList.toggle('active', micOn);
  btnMic.classList.toggle('muted', !micOn);
  btnMic.title = micOn ? 'Mute' : 'Unmute';
});

btnCam.addEventListener('click', () => {
  camOn = !camOn;
  localStream?.getVideoTracks().forEach(t => (t.enabled = camOn));
  btnCam.classList.toggle('active', camOn);
  btnCam.classList.toggle('muted', !camOn);
  toggleLocalCamOverlay(!camOn);
});

function toggleLocalCamOverlay(show) {
  const tile = $('tile-local');
  if (!tile) return;
  const overlay = tile.querySelector('.cam-off-overlay');
  if (overlay) overlay.classList.toggle('hidden', !show);
}

/* ── Toggle password visibility ──────────────────────────────── */
toggleEye.addEventListener('click', () => {
  const type = codeInput.type === 'password' ? 'text' : 'password';
  codeInput.type = type;
  toggleEye.style.color = type === 'text' ? 'var(--accent)' : '';
});

/* ── JOIN ────────────────────────────────────────────────────── */
joinBtn.addEventListener('click', doJoin);
codeInput.addEventListener('keydown', e => e.key === 'Enter' && doJoin());
nameInput.addEventListener('keydown', e => e.key === 'Enter' && codeInput.focus());

async function doJoin() {
  const code = codeInput.value.trim();
  const name = nameInput.value.trim() || 'Anonymous';

  if (!code) { showError('Please enter the access code.'); return; }

  joinBtn.disabled = true;
  joinBtn.querySelector('span').textContent = 'Connecting…';

  // Get camera + mic
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch (_) {
    // fallback: audio only or nothing
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      showToast('⚠️ Camera not available — audio only');
    } catch (__) {
      localStream = new MediaStream(); // empty
      showToast('⚠️ No media devices found');
    }
  }

  connectSocket(code, name);
}

function showError(msg) {
  joinError.textContent = msg;
  joinError.classList.remove('hidden');
  joinBtn.disabled = false;
  joinBtn.querySelector('span').textContent = 'Enter Room';
}

/* ── SOCKET ──────────────────────────────────────────────────── */
function connectSocket(code, name) {
  socket = io();

  socket.on('connect', () => {
    mySocketId = socket.id;
    socket.emit('join-request', { code, name });
  });

  socket.on('join-rejected', ({ message }) => {
    socket.disconnect();
    localStream?.getTracks().forEach(t => t.stop());
    localStream = null;
    showError(message);
  });

  socket.on('join-accepted', ({ user, existingUsers }) => {
    myName = user.name;
    mySocketId = user.socketId;

    // Switch to room UI
    showScreen('room-screen');
    addLocalTile();
    updatePeerCount();

    // Initiate a peer connection to every existing user
    existingUsers.forEach(u => {
      peerNames.set(u.socketId, u.name);
      createPeer(u.socketId, true /* we call first */);
    });

    addSystemMsg(`You joined as ${myName}`);
  });

  socket.on('user-joined', async (user) => {
    peerNames.set(user.socketId, user.name);
    // The new peer will send us an offer — we just wait
    addSystemMsg(`${user.name} joined`);
    showToast(`${user.name} joined the room`);
    updatePeerCount();
  });

  socket.on('user-left', ({ socketId, name }) => {
    removePeer(socketId);
    peerNames.delete(socketId);
    addSystemMsg(`${name} left`);
    showToast(`${name} left`);
    updatePeerCount();
  });

  /* ── WebRTC signaling ── */
  socket.on('offer', async ({ from, fromName, offer }) => {
    peerNames.set(from, fromName);
    const pc = createPeer(from, false);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('answer', { to: from, answer });
  });

  socket.on('answer', async ({ from, answer }) => {
    const pc = peers.get(from);
    if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
  });

  socket.on('ice-candidate', async ({ from, candidate }) => {
    const pc = peers.get(from);
    if (pc && candidate) {
      try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (_) {}
    }
  });

  /* ── Chat ── */
  socket.on('chat-message', ({ from, name, message, time }) => {
    addChatMessage({ from, name, message, time });
    if (!chatPanel.classList.contains('open')) {
      let count = parseInt(chatBadge.textContent || '0') + 1;
      chatBadge.textContent = count;
      chatBadge.classList.remove('hidden');
    }
  });

  socket.on('disconnect', () => {
    if (roomScreen.classList.contains('active')) {
      showToast('Disconnected from server. Refresh to rejoin.');
    }
  });
}

/* ── WebRTC peer ──────────────────────────────────────────────── */
function createPeer(remoteId, isInitiator) {
  if (peers.has(remoteId)) return peers.get(remoteId);

  const pc = new RTCPeerConnection(RTC_CONFIG);
  peers.set(remoteId, pc);

  // Add our tracks
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  // Send ICE candidates
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) socket.emit('ice-candidate', { to: remoteId, candidate });
  };

  // Receive remote stream
  pc.ontrack = ({ streams }) => {
    const stream = streams[0];
    addOrUpdateRemoteTile(remoteId, stream);
  };

  pc.onconnectionstatechange = () => {
    if (['disconnected','failed','closed'].includes(pc.connectionState)) {
      removePeer(remoteId);
    }
  };

  if (isInitiator) {
    pc.onnegotiationneeded = async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('offer', { to: remoteId, offer: pc.localDescription });
      } catch (_) {}
    };
  }

  return pc;
}

function removePeer(id) {
  const pc = peers.get(id);
  if (pc) { pc.close(); peers.delete(id); }
  const tile = $(`tile-${id}`);
  if (tile) tile.remove();
  updatePeerCount();
}

/* ── Video tiles ─────────────────────────────────────────────── */
function addLocalTile() {
  const tile = document.createElement('div');
  tile.className = 'video-tile local';
  tile.id = 'tile-local';
  tile.innerHTML = `
    <video id="localVideo" autoplay muted playsinline></video>
    <div class="cam-off-overlay hidden">
      <div class="avatar-circle">${initials(myName)}</div>
      <span>Camera off</span>
    </div>
    <div class="tile-label">
      ${myName}
      <span class="you-badge">YOU</span>
    </div>`;
  videoGrid.appendChild(tile);
  const vid = tile.querySelector('video');
  vid.srcObject = localStream;
}

function addOrUpdateRemoteTile(id, stream) {
  let tile = $(`tile-${id}`);
  if (!tile) {
    tile = document.createElement('div');
    tile.className = 'video-tile';
    tile.id = `tile-${id}`;
    const name = peerNames.get(id) || 'Peer';
    tile.innerHTML = `
      <video autoplay playsinline></video>
      <div class="cam-off-overlay hidden">
        <div class="avatar-circle">${initials(name)}</div>
        <span>${name}</span>
      </div>
      <div class="tile-label">${name}</div>`;
    videoGrid.appendChild(tile);
  }
  const vid = tile.querySelector('video');
  if (vid.srcObject !== stream) vid.srcObject = stream;

  // Show/hide cam overlay based on video tracks
  stream.onaddtrack = stream.onremovetrack = () => syncRemoteCamOverlay(tile, stream);
  syncRemoteCamOverlay(tile, stream);
}

function syncRemoteCamOverlay(tile, stream) {
  const hasVideo = stream.getVideoTracks().some(t => t.enabled && t.readyState === 'live');
  const overlay = tile.querySelector('.cam-off-overlay');
  if (overlay) overlay.classList.toggle('hidden', hasVideo);
}

/* ── Leave ───────────────────────────────────────────────────── */
btnLeave.addEventListener('click', leaveRoom);
function leaveRoom() {
  peers.forEach((pc, id) => { pc.close(); });
  peers.clear();
  socket?.disconnect();
  localStream?.getTracks().forEach(t => t.stop());
  localStream = null;
  videoGrid.innerHTML = '';
  chatMessages.innerHTML = '';
  showScreen('join-screen');
  joinBtn.disabled = false;
  joinBtn.querySelector('span').textContent = 'Enter Room';
  joinError.classList.add('hidden');
  codeInput.value = '';
  chatPanel.classList.remove('open');
  chatBadge.classList.add('hidden');
  chatBadge.textContent = '0';
}

/* ── Chat panel ──────────────────────────────────────────────── */
btnChat.addEventListener('click', () => {
  chatPanel.classList.add('open');
  chatBadge.classList.add('hidden');
  chatBadge.textContent = '0';
  chatInput.focus();
});
closeChat.addEventListener('click', () => chatPanel.classList.remove('open'));

function sendChat() {
  const msg = chatInput.value.trim();
  if (!msg || !socket) return;
  socket.emit('chat-message', { message: msg });
  chatInput.value = '';
}
chatSend.addEventListener('click', sendChat);
chatInput.addEventListener('keydown', e => e.key === 'Enter' && sendChat());

function addChatMessage({ from, name, message, time }) {
  const own = from === mySocketId;
  const t = new Date(time);
  const timeStr = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const div = document.createElement('div');
  div.className = `chat-msg${own ? ' own' : ''}`;
  div.innerHTML = `
    <div class="msg-meta">
      <span class="msg-name">${escHtml(name)}</span>
      <span class="msg-time">${timeStr}</span>
    </div>
    <div class="msg-text">${escHtml(message)}</div>`;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addSystemMsg(text) {
  const div = document.createElement('div');
  div.className = 'chat-system';
  div.textContent = text;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
          .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
