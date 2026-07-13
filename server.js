const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Fallback to index.html for single page layout
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Keep track of connected users
// Structure of user:
// {
//   id: string (socket.id),
//   interests: string[],
//   gender: 'male' | 'female' | 'unknown',
//   peerId: string | null, // current matched peer socket.id
//   isSearching: boolean
// }
const users = new Map();

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);
  
  // Register user info initially
  users.set(socket.id, {
    id: socket.id,
    interests: [],
    gender: 'unknown',
    peerId: null,
    isSearching: false
  });

  // Emit current online users count to all users
  io.emit('stats', { onlineCount: users.size });

  // Update user profile (interests and gender)
  socket.on('update-profile', (profile) => {
    const user = users.get(socket.id);
    if (user) {
      user.interests = Array.isArray(profile.interests) 
        ? profile.interests.map(t => t.trim().toLowerCase()) 
        : [];
      user.gender = ['male', 'female', 'unknown'].includes(profile.gender) 
        ? profile.gender 
        : 'unknown';
      console.log(`Updated profile for ${socket.id}:`, { interests: user.interests, gender: user.gender });
    }
  });

  // Request matchmaking
  socket.on('search-match', () => {
    const user = users.get(socket.id);
    if (!user) return;

    // If already in a match, disconnect from previous first
    if (user.peerId) {
      disconnectPeer(socket.id);
    }

    user.isSearching = true;
    user.peerId = null;

    console.log(`User ${socket.id} is searching for a match. Interests: [${user.interests.join(', ')}], Gender: ${user.gender}`);

    // Try to find a match immediately
    tryMatch(socket);
  });

  // Disconnect from peer / Skip
  socket.on('skip', () => {
    console.log(`User ${socket.id} skipped current match.`);
    disconnectPeer(socket.id);
  });

  // Relay WebRTC signaling messages
  socket.on('signal', ({ target, data }) => {
    const user = users.get(socket.id);
    if (user && user.peerId === target) {
      io.to(target).emit('signal', {
        sender: socket.id,
        data: data
      });
    }
  });

  // Relay text messages
  socket.on('chat-message', (message) => {
    const user = users.get(socket.id);
    if (user && user.peerId) {
      io.to(user.peerId).emit('chat-message', {
        sender: 'peer',
        text: message
      });
    }
  });

  // Handle typing indicator
  socket.on('typing', (isTyping) => {
    const user = users.get(socket.id);
    if (user && user.peerId) {
      io.to(user.peerId).emit('typing', isTyping);
    }
  });

  // Disconnect handler
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    disconnectPeer(socket.id);
    users.delete(socket.id);
    // Update active count
    io.emit('stats', { onlineCount: users.size });
  });
});

/**
 * Disconnects a user from their active peer connection
 */
function disconnectPeer(socketId) {
  const user = users.get(socketId);
  if (!user) return;

  const peerId = user.peerId;
  user.peerId = null;
  user.isSearching = false;

  if (peerId) {
    const peer = users.get(peerId);
    if (peer) {
      peer.peerId = null;
      peer.isSearching = false;
      io.to(peerId).emit('peer-disconnected');
    }
  }
}

/**
 * Attempts to match a searching socket with a suitable partner
 */
function tryMatch(socket) {
  const u = users.get(socket.id);
  if (!u || !u.isSearching) return;

  const candidates = [];
  let maxScore = -1;

  for (const [id, w] of users.entries()) {
    // Skip self or users not actively searching
    if (id === socket.id || !w.isSearching || w.peerId) continue;

    // Calculate score
    // 1. Tag overlap score (10 points per shared tag)
    let commonTags = 0;
    if (u.interests.length > 0 && w.interests.length > 0) {
      commonTags = u.interests.filter(tag => w.interests.includes(tag)).length;
    }
    
    // 2. Gender matching optimization (boost of 100 points for male-female pair)
    const isOppositeGender = 
      (u.gender === 'male' && w.gender === 'female') ||
      (u.gender === 'female' && w.gender === 'male');
    
    // High opposite gender boost (100) ensures opposite gender pairings are highly prioritized
    const genderBoost = isOppositeGender ? 100 : 0;
    const score = (commonTags * 10) + genderBoost;

    candidates.push({ user: w, score: score });
    if (score > maxScore) {
      maxScore = score;
    }
  }

  // If we found any candidates, pick one of the best ones randomly
  if (candidates.length > 0) {
    const bestCandidates = candidates.filter(c => c.score === maxScore);
    const randomChoice = bestCandidates[Math.floor(Math.random() * bestCandidates.length)];
    const w = randomChoice.user;
    
    // Pair them up
    u.peerId = w.id;
    w.peerId = u.id;
    u.isSearching = false;
    w.isSearching = false;

    console.log(`Matched ${u.id} and ${w.id} (Score: ${maxScore})`);

    // Let them know who initiates the connection (to avoid call collisions)
    io.to(u.id).emit('matched', {
      peerId: w.id,
      interests: w.interests,
      gender: w.gender,
      isCaller: true
    });

    io.to(w.id).emit('matched', {
      peerId: u.id,
      interests: u.interests,
      gender: u.gender,
      isCaller: false
    });
  }
}

server.listen(PORT, () => {
  console.log(`Omegle-like server is running on http://localhost:${PORT}`);
});
