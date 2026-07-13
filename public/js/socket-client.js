class SocketClient {
  constructor() {
    this.socket = null;
    this.onlineCountEl = document.getElementById('online-count');
    this.callbacks = {};
  }

  connect() {
    // Connects to the same origin server
    this.socket = io();

    this.socket.on('connect', () => {
      console.log('Connected to signaling server with ID:', this.socket.id);
    });

    // Handle online stats
    this.socket.on('stats', (data) => {
      if (this.onlineCountEl && data.onlineCount !== undefined) {
        this.onlineCountEl.textContent = `${data.onlineCount} online`;
      }
    });

    // Handle matchmaking pairing
    this.socket.on('matched', (matchData) => {
      console.log('Match found by server:', matchData);
      if (this.callbacks.onMatch) {
        this.callbacks.onMatch(matchData);
      }
    });

    // Handle incoming WebRTC signaling data
    this.socket.on('signal', (signalData) => {
      if (this.callbacks.onSignal) {
        this.callbacks.onSignal(signalData);
      }
    });

    // Handle peer disconnecting
    this.socket.on('peer-disconnected', () => {
      console.log('Peer disconnected.');
      if (this.callbacks.onPeerDisconnected) {
        this.callbacks.onPeerDisconnected();
      }
    });

    // Handle text messages
    this.socket.on('chat-message', (msg) => {
      if (this.callbacks.onChatMessage) {
        this.callbacks.onChatMessage(msg);
      }
    });

    // Handle peer typing indicator
    this.socket.on('typing', (isTyping) => {
      if (this.callbacks.onTypingState) {
        this.callbacks.onTypingState(isTyping);
      }
    });

    this.socket.on('disconnect', () => {
      console.log('Disconnected from signaling server.');
      if (this.callbacks.onServerDisconnect) {
        this.callbacks.onServerDisconnect();
      }
    });
  }

  // Register callback handlers
  on(event, callback) {
    this.callbacks[event] = callback;
  }

  updateProfile(interests, gender) {
    if (!this.socket) return;
    this.socket.emit('update-profile', {
      interests: interests,
      gender: gender
    });
  }

  startSearch() {
    if (!this.socket) return;
    this.socket.emit('search-match');
  }

  skipMatch() {
    if (!this.socket) return;
    this.socket.emit('skip');
  }

  sendSignal(target, data) {
    if (!this.socket) return;
    this.socket.emit('signal', {
      target: target,
      data: data
    });
  }

  sendChatMessage(message) {
    if (!this.socket) return;
    this.socket.emit('chat-message', message);
  }

  sendTypingState(isTyping) {
    if (!this.socket) return;
    this.socket.emit('typing', isTyping);
  }
}

// Instantiate client
document.addEventListener('DOMContentLoaded', () => {
  window.socketClient = new SocketClient();
  window.socketClient.connect();
});
