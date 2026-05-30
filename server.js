const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const SECRET_CODE = '5566';
const ROOM_ID = 'global-room-5566';

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Track users in room
const usersInRoom = new Map(); // socketId -> { name, socketId }

io.on('connection', (socket) => {
  console.log(`[+] Socket connected: ${socket.id}`);

  // Step 1: Validate access code
  socket.on('join-request', ({ code, name }) => {
    if (code !== SECRET_CODE) {
      socket.emit('join-rejected', { message: 'Invalid access code. Try again.' });
      return;
    }

    const userName = (name || 'Anonymous').trim().slice(0, 24) || 'Anonymous';
    const user = { name: userName, socketId: socket.id };

    // Join the signaling room
    socket.join(ROOM_ID);
    usersInRoom.set(socket.id, user);

    // Tell the joiner who else is already in the room
    const existingUsers = [...usersInRoom.values()].filter(u => u.socketId !== socket.id);
    socket.emit('join-accepted', { user, existingUsers });

    // Tell everyone else someone new joined
    socket.to(ROOM_ID).emit('user-joined', user);

    console.log(`[✓] ${userName} (${socket.id}) joined. Total: ${usersInRoom.size}`);
  });

  // ─── WebRTC Signaling ───────────────────────────────────────────────────
  socket.on('offer', ({ to, offer }) => {
    const from = usersInRoom.get(socket.id);
    if (from) {
      io.to(to).emit('offer', { from: socket.id, fromName: from.name, offer });
    }
  });

  socket.on('answer', ({ to, answer }) => {
    io.to(to).emit('answer', { from: socket.id, answer });
  });

  socket.on('ice-candidate', ({ to, candidate }) => {
    io.to(to).emit('ice-candidate', { from: socket.id, candidate });
  });

  // ─── Chat ───────────────────────────────────────────────────────────────
  socket.on('chat-message', ({ message }) => {
    const user = usersInRoom.get(socket.id);
    if (!user || !message.trim()) return;
    const payload = {
      from: socket.id,
      name: user.name,
      message: message.trim().slice(0, 500),
      time: new Date().toISOString()
    };
    io.to(ROOM_ID).emit('chat-message', payload);
  });

  // ─── Disconnect ─────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    const user = usersInRoom.get(socket.id);
    if (user) {
      usersInRoom.delete(socket.id);
      io.to(ROOM_ID).emit('user-left', { socketId: socket.id, name: user.name });
      console.log(`[-] ${user.name} (${socket.id}) left. Total: ${usersInRoom.size}`);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀  GlobalChat server running → http://localhost:${PORT}`);
  console.log(`🔑  Access code: ${SECRET_CODE}\n`);
});
