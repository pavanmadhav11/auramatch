document.addEventListener('DOMContentLoaded', () => {
  // UI State
  let appState = 'idle'; // 'idle', 'searching', 'matched'
  let currentPeerId = null;
  let peerConnection = null;
  let localStream = null;
  let interestTags = [];
  let voiceGender = 'unknown';
  let isTypingTimeout = null;

  // Configuration for WebRTC
  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  // UI DOM Elements
  const tagInput = document.getElementById('tag-input');
  const addTagBtn = document.getElementById('add-tag-btn');
  const tagsList = document.getElementById('tags-list');
  
  const matchControlBtn = document.getElementById('match-control-btn');
  const chatInput = document.getElementById('chat-input');
  const sendMsgBtn = document.getElementById('send-msg-btn');
  const messagesLog = document.getElementById('messages-log');
  
  const remoteVideo = document.getElementById('remote-video');
  const videoPlaceholder = document.getElementById('video-placeholder');
  const matchStatusText = document.getElementById('match-status-text');
  const matchingTagsOverlay = document.getElementById('matching-tags-overlay');
  
  const typingIndicator = document.getElementById('typing-indicator');

  // Initialize camera stream
  async function setupLocalCamera() {
    try {
      if (window.filterPipeline) {
        localStream = await window.filterPipeline.initializeStream();
      }
    } catch (err) {
      console.error('Camera initialization failed:', err);
      appendSystemMessage('System Error: Camera access denied. You will not be able to video chat.');
    }
  }

  setupLocalCamera();

  // Voice Analyzer Completion Callback
  window.onVoiceAnalyzerComplete = (gender) => {
    voiceGender = gender;
    // Notify server of updated gender profile
    if (window.socketClient) {
      window.socketClient.updateProfile(interestTags, voiceGender);
    }
    appendSystemMessage(`AI voice calibration locked in: Identified as ${gender.toUpperCase()}`);
  };

  // Interest tags management
  function addTag(tagText) {
    const formattedTag = tagText.trim().toLowerCase();
    if (!formattedTag || interestTags.includes(formattedTag)) return;

    interestTags.push(formattedTag);
    renderTagChips();
    
    // Update socket profile
    if (window.socketClient) {
      window.socketClient.updateProfile(interestTags, voiceGender);
    }
  }

  function removeTag(tagText) {
    interestTags = interestTags.filter(t => t !== tagText);
    renderTagChips();

    // Update socket profile
    if (window.socketClient) {
      window.socketClient.updateProfile(interestTags, voiceGender);
    }
  }

  function renderTagChips() {
    tagsList.innerHTML = '';
    interestTags.forEach(tag => {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      chip.innerHTML = `${tag} <button data-tag="${tag}">&times;</button>`;
      tagsList.appendChild(chip);
    });

    // Add remove listeners
    tagsList.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tag = e.target.dataset.tag;
        removeTag(tag);
      });
    });
  }

  tagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      addTag(tagInput.value);
      tagInput.value = '';
    }
  });

  addTagBtn.addEventListener('click', () => {
    addTag(tagInput.value);
    tagInput.value = '';
  });

  // Chat message visual helpers
  function appendSystemMessage(text, className = '') {
    const msg = document.createElement('div');
    msg.className = `system-message ${className}`;
    msg.textContent = text;
    messagesLog.appendChild(msg);
    messagesLog.scrollTop = messagesLog.scrollHeight;
  }

  function appendChatBubble(sender, text) {
    const bubble = document.createElement('div');
    bubble.className = `chat-message-bubble ${sender}`;
    bubble.textContent = text;
    messagesLog.appendChild(bubble);
    messagesLog.scrollTop = messagesLog.scrollHeight;
  }

  // Handle send message
  function sendChatMessage() {
    const text = chatInput.value.trim();
    if (!text || appState !== 'matched') return;

    // Append to local log
    appendChatBubble('you', text);
    chatInput.value = '';
    
    // Clear typing timeout
    if (window.socketClient) {
      window.socketClient.sendChatMessage(text);
      window.socketClient.sendTypingState(false);
    }
  }

  sendMsgBtn.addEventListener('click', sendChatMessage);
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      sendChatMessage();
    } else {
      // Trigger typing indicator
      if (window.socketClient) {
        window.socketClient.sendTypingState(true);
        
        clearTimeout(isTypingTimeout);
        isTypingTimeout = setTimeout(() => {
          window.socketClient.sendTypingState(false);
        }, 2000);
      }
    }
  });

  // Match Control search workflow
  matchControlBtn.addEventListener('click', () => {
    if (appState === 'idle') {
      startSearchCycle();
    } else if (appState === 'searching') {
      stopSearchCycle();
    } else if (appState === 'matched') {
      skipToNextMatch();
    }
  });

  function startSearchCycle() {
    appState = 'searching';
    matchControlBtn.className = 'btn btn-secondary';
    matchControlBtn.innerHTML = '<i data-lucide="square"></i> Stop Search';
    lucide.createIcons();

    // Reset layout elements
    videoPlaceholder.classList.remove('hidden');
    videoPlaceholder.classList.add('searching');
    remoteVideo.classList.add('hidden');
    
    matchStatusText.textContent = 'Searching for a partner...';
    matchingTagsOverlay.innerHTML = '';
    
    chatInput.disabled = true;
    sendMsgBtn.disabled = true;

    appendSystemMessage('Looking for people with similar interests...');

    // Request match matching server
    if (window.socketClient) {
      window.socketClient.startSearch();
    }
  }

  function stopSearchCycle() {
    appState = 'idle';
    matchControlBtn.className = 'btn btn-primary start-search-btn';
    matchControlBtn.innerHTML = '<i data-lucide="play"></i> Start Search';
    lucide.createIcons();

    videoPlaceholder.classList.remove('searching');
    matchStatusText.textContent = 'Click "Start Search" to find a partner';
    
    closeRTCPeerConnection();
    
    if (window.socketClient) {
      window.socketClient.skipMatch();
    }
    
    appendSystemMessage('Search cancelled.');
  }

  function skipToNextMatch() {
    appendSystemMessage('Skipping to next...');
    
    closeRTCPeerConnection();
    
    if (window.socketClient) {
      window.socketClient.skipMatch();
    }
    
    // Instantly queue search cycle
    startSearchCycle();
  }

  // Close active connection
  function closeRTCPeerConnection() {
    currentPeerId = null;
    typingIndicator.classList.add('hidden');

    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }

    remoteVideo.srcObject = null;
    remoteVideo.classList.add('hidden');
    
    videoPlaceholder.classList.remove('hidden');
    videoPlaceholder.classList.remove('searching');
    matchStatusText.textContent = 'Click "Start Search" to find a partner';
    matchingTagsOverlay.innerHTML = '';

    chatInput.disabled = true;
    chatInput.value = '';
    sendMsgBtn.disabled = true;
  }

  // Socket callback hooks hookup
  if (window.socketClient) {
    // 1. Matched with peer event
    window.socketClient.on('onMatch', (matchData) => {
      appState = 'matched';
      currentPeerId = matchData.peerId;

      matchControlBtn.className = 'btn btn-danger';
      matchControlBtn.innerHTML = '<i data-lucide="skip-forward"></i> Next Match';
      lucide.createIcons();

      videoPlaceholder.classList.remove('searching');
      videoPlaceholder.classList.add('hidden');
      remoteVideo.classList.remove('hidden');

      chatInput.disabled = false;
      sendMsgBtn.disabled = false;
      chatInput.focus();

      // Show match tags/info
      let matchInfo = 'Connected with a stranger.';
      if (matchData.interests && matchData.interests.length > 0) {
        matchInfo += ` Common interests: ${matchData.interests.join(', ')}`;
      }
      if (matchData.gender && matchData.gender !== 'unknown') {
        matchInfo += ` [AI Voice: ${matchData.gender.toUpperCase()}]`;
      }
      appendSystemMessage(matchInfo, 'match-found');

      // Initialize WebRTC
      initializeWebRTC(matchData.peerId, matchData.isCaller);
    });

    // 2. Relay signaling data
    window.socketClient.on('onSignal', async (signalData) => {
      if (!peerConnection || signalData.sender !== currentPeerId) return;

      try {
        if (signalData.data.sdp) {
          console.log('Received SDP description:', signalData.data.sdp.type);
          await peerConnection.setRemoteDescription(new RTCSessionDescription(signalData.data.sdp));
          
          if (signalData.data.sdp.type === 'offer') {
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            window.socketClient.sendSignal(currentPeerId, { sdp: answer });
          }
        } else if (signalData.data.candidate) {
          console.log('Received ICE Candidate');
          await peerConnection.addIceCandidate(new RTCIceCandidate(signalData.data.candidate));
        }
      } catch (err) {
        console.error('Error handling signaling packet:', err);
      }
    });

    // 3. Peer disconnected event
    window.socketClient.on('onPeerDisconnected', () => {
      appendSystemMessage('Stranger disconnected.');
      closeRTCPeerConnection();
      
      // Auto reconnect/continue searching if we were in match state
      if (appState === 'matched') {
        startSearchCycle();
      }
    });

    // 4. Chat Message received
    window.socketClient.on('onChatMessage', (msg) => {
      appendChatBubble('peer', msg.text);
    });

    // 5. Typing states
    window.socketClient.on('onTypingState', (isTyping) => {
      if (isTyping) {
        typingIndicator.classList.remove('hidden');
      } else {
        typingIndicator.classList.add('hidden');
      }
    });
  }

  // WebRTC Peer Connection Core
  function initializeWebRTC(peerId, isCaller) {
    peerConnection = new RTCPeerConnection(rtcConfig);

    // Track state changes
    peerConnection.onconnectionstatechange = () => {
      console.log('Connection state:', peerConnection.connectionState);
      if (peerConnection.connectionState === 'failed') {
        appendSystemMessage('WebRTC Connection failed. Trying to reconnect...');
      }
    };

    // Send local filtered canvas stream tracks
    const processedStream = window.filterPipeline ? window.filterPipeline.getFilteredStream() : localStream;
    if (processedStream) {
      processedStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, processedStream);
      });
      console.log('Attached local tracks to RTCPeerConnection');
    } else {
      console.warn('No local stream track found to attach');
    }

    // Ice candidates handling
    peerConnection.onicecandidate = (event) => {
      if (event.candidate && window.socketClient) {
        window.socketClient.sendSignal(peerId, { candidate: event.candidate });
      }
    };

    // Feed remote tracks into DOM video player
    peerConnection.ontrack = (event) => {
      console.log('Received remote media stream track:', event.track.kind);
      if (remoteVideo.srcObject !== event.streams[0]) {
        remoteVideo.srcObject = event.streams[0];
      }
    };

    // Negotiate connection
    if (isCaller) {
      peerConnection.onnegotiationneeded = async () => {
        try {
          console.log('Negotiation needed: creating WebRTC Offer');
          const offer = await peerConnection.createOffer();
          await peerConnection.setLocalDescription(offer);
          if (window.socketClient) {
            window.socketClient.sendSignal(peerId, { sdp: offer });
          }
        } catch (err) {
          console.error('Error during offer negotiation:', err);
        }
      };
    }
  }
});
