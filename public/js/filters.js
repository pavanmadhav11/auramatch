class VideoFilterPipeline {
  constructor() {
    this.localVideo = document.getElementById('local-video');
    this.localCanvas = document.getElementById('local-canvas');
    this.canvasCtx = this.localCanvas?.getContext('2d');
    this.stream = null;
    this.animationFrameId = null;

    // Filters and Stickers State
    this.currentFilter = 'normal';
    this.currentSticker = 'none';
    
    // Sticker position, scale, and rotation
    this.stickerState = {
      x: 0,
      y: 0,
      scale: 1.0,
      rotation: 0 // degrees
    };

    this.isDragging = false;
    this.dragStartOffset = { x: 0, y: 0 };

    this.setupEvents();
  }

  async initializeStream() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, frameRate: 30 },
        audio: true
      });
      
      this.localVideo.srcObject = this.stream;
      
      // Wait for metadata to load to get correct dimensions
      await new Promise((resolve) => {
        this.localVideo.onloadedmetadata = () => {
          resolve();
        };
      });
      
      this.localCanvas.width = 640;
      this.localCanvas.height = 480;
      
      // Initialize sticker position to the center of the canvas
      this.stickerState.x = this.localCanvas.width / 2;
      this.stickerState.y = this.localCanvas.height / 2;

      this.startProcessingLoop();
      console.log('Video Filter Pipeline initialized.');
      return this.stream;
    } catch (err) {
      console.error('Error starting video stream:', err);
      alert('Could not access your camera. Please ensure camera permissions are allowed.');
      throw err;
    }
  }

  stopStream() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
  }

  setupEvents() {
    // Canvas Dragging Listeners (Mouse & Touch)
    const startDrag = (clientX, clientY) => {
      if (this.currentSticker === 'none') return;

      const rect = this.localCanvas.getBoundingClientRect();
      // Calculate coordinates scaled to internal canvas dimensions
      const mouseX = ((clientX - rect.left) / rect.width) * this.localCanvas.width;
      const mouseY = ((clientY - rect.top) / rect.height) * this.localCanvas.height;

      // Check if mouse is relatively close to the sticker center
      const dx = mouseX - this.stickerState.x;
      const dy = mouseY - this.stickerState.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Sticker hit radius roughly 100px adjusted by scale
      const hitRadius = 80 * this.stickerState.scale;

      if (distance < hitRadius) {
        this.isDragging = true;
        this.dragStartOffset.x = dx;
        this.dragStartOffset.y = dy;
      }
    };

    const doDrag = (clientX, clientY) => {
      if (!this.isDragging) return;

      const rect = this.localCanvas.getBoundingClientRect();
      const mouseX = ((clientX - rect.left) / rect.width) * this.localCanvas.width;
      const mouseY = ((clientY - rect.top) / rect.height) * this.localCanvas.height;

      // Update sticker position relative to cursor and offset
      this.stickerState.x = Math.max(0, Math.min(this.localCanvas.width, mouseX - this.dragStartOffset.x));
      this.stickerState.y = Math.max(0, Math.min(this.localCanvas.height, mouseY - this.dragStartOffset.y));
    };

    const stopDrag = () => {
      this.isDragging = false;
    };

    // Mouse events
    this.localCanvas.addEventListener('mousedown', (e) => startDrag(e.clientX, e.clientY));
    window.addEventListener('mousemove', (e) => doDrag(e.clientX, e.clientY));
    window.addEventListener('mouseup', stopDrag);

    // Touch events
    this.localCanvas.addEventListener('touchstart', (e) => {
      if (e.touches.length > 0) {
        startDrag(e.touches[0].clientX, e.touches[0].clientY);
      }
    });
    window.addEventListener('touchmove', (e) => {
      if (this.isDragging && e.touches.length > 0) {
        doDrag(e.touches[0].clientX, e.touches[0].clientY);
        e.preventDefault(); // Prevent scrolling while dragging sticker
      }
    }, { passive: false });
    window.addEventListener('touchend', stopDrag);

    // UI Event Listeners for Filters
    const filterButtons = document.querySelectorAll('.filter-btn');
    filterButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        filterButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentFilter = btn.dataset.filter;
        console.log('Applied visual style:', this.currentFilter);
      });
    });

    // UI Event Listeners for Stickers
    const stickerButtons = document.querySelectorAll('.sticker-btn');
    const stickerControls = document.getElementById('sticker-controls');
    
    stickerButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        stickerButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentSticker = btn.dataset.sticker;

        if (this.currentSticker === 'none') {
          stickerControls.style.display = 'none';
        } else {
          stickerControls.style.display = 'block';
          // Re-center sticker to be helpful
          this.stickerState.x = this.localCanvas.width / 2;
          this.stickerState.y = this.localCanvas.height / 2;
        }
        console.log('Applied sticker effect:', this.currentSticker);
      });
    });

    // Scale and Rotation sliders
    const scaleSlider = document.getElementById('sticker-scale');
    const rotSlider = document.getElementById('sticker-rotation');

    if (scaleSlider) {
      scaleSlider.addEventListener('input', (e) => {
        this.stickerState.scale = parseFloat(e.target.value);
      });
    }

    if (rotSlider) {
      rotSlider.addEventListener('input', (e) => {
        this.stickerState.rotation = parseInt(e.target.value);
      });
    }
  }

  // Captures canvas as media stream for WebRTC sharing
  getFilteredStream() {
    // Capture stream at 30fps
    const canvasStream = this.localCanvas.captureStream(30);
    
    // WebRTC connection also needs the actual microphone audio track
    if (this.stream) {
      const audioTrack = this.stream.getAudioTracks()[0];
      if (audioTrack) {
        canvasStream.addTrack(audioTrack);
      }
    }
    
    return canvasStream;
  }

  startProcessingLoop() {
    const processFrame = () => {
      if (!this.stream) return;

      this.canvasCtx.save();
      
      // Mirror the local camera display so it feels natural for the local user
      this.canvasCtx.translate(this.localCanvas.width, 0);
      this.canvasCtx.scale(-1, 1);
      
      // Draw camera image
      this.canvasCtx.drawImage(this.localVideo, 0, 0, this.localCanvas.width, this.localCanvas.height);
      
      this.canvasCtx.restore();

      // Apply Filters
      this.applyFilterEffect();

      // Draw Sticker overlay
      this.drawStickerOverlay();

      this.animationFrameId = requestAnimationFrame(processFrame);
    };

    this.animationFrameId = requestAnimationFrame(processFrame);
  }

  applyFilterEffect() {
    const width = this.localCanvas.width;
    const height = this.localCanvas.height;
    
    if (this.currentFilter === 'normal') return;

    if (this.currentFilter === 'sepia') {
      this.canvasCtx.filter = 'sepia(80%)';
      // To apply canvas filter we redraw canvas on itself
      this.canvasCtx.drawImage(this.localCanvas, 0, 0);
      this.canvasCtx.filter = 'none';
      return;
    }

    if (this.currentFilter === 'grayscale') {
      this.canvasCtx.filter = 'grayscale(100%)';
      this.canvasCtx.drawImage(this.localCanvas, 0, 0);
      this.canvasCtx.filter = 'none';
      return;
    }

    // Advanced manual pixel filters
    const imgData = this.canvasCtx.getImageData(0, 0, width, height);
    const data = imgData.data;

    if (this.currentFilter === 'thermal') {
      // Thermal camera effect mapping
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i+1];
        const b = data[i+2];
        
        // Luminance
        const val = 0.3 * r + 0.59 * g + 0.11 * b;
        
        // Thermal map mapping (low luminance is blue, high is red/white)
        if (val < 64) {
          data[i] = 0; // Red
          data[i+1] = 0; // Green
          data[i+2] = val * 4; // Blue
        } else if (val < 128) {
          data[i] = 0;
          data[i+1] = (val - 64) * 4;
          data[i+2] = 255 - (val - 64) * 4;
        } else if (val < 192) {
          data[i] = (val - 128) * 4;
          data[i+1] = 255;
          data[i+2] = 0;
        } else {
          data[i] = 255;
          data[i+1] = 255 - (val - 192) * 4;
          data[i+2] = (val - 192) * 4;
        }
      }
      this.canvasCtx.putImageData(imgData, 0, 0);
    } else if (this.currentFilter === 'neon') {
      // High contrast outline detection filter
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = width;
      tempCanvas.height = height;
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.putImageData(imgData, 0, 0);

      // Clear main canvas with black background
      this.canvasCtx.fillStyle = '#050508';
      this.canvasCtx.fillRect(0, 0, width, height);

      // Perform a Sobel-like simple horizontal/vertical edge approximation
      const edgeData = this.canvasCtx.createImageData(width, height);
      const edge = edgeData.data;

      // Sobel kernel approximations
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const idx = (y * width + x) * 4;
          
          // Grayscale values surrounding pixel
          const getGray = (ox, oy) => {
            const i = ((y + oy) * width + (x + ox)) * 4;
            return 0.3 * data[i] + 0.59 * data[i+1] + 0.11 * data[i+2];
          };

          const hVal = (getGray(1, -1) - getGray(-1, -1)) + 
                       2 * (getGray(1, 0) - getGray(-1, 0)) + 
                       (getGray(1, 1) - getGray(-1, 1));
          
          const vVal = (getGray(-1, 1) - getGray(-1, -1)) + 
                       2 * (getGray(0, 1) - getGray(0, -1)) + 
                       (getGray(1, 1) - getGray(1, -1));

          const mag = Math.sqrt(hVal * hVal + vVal * vVal);
          
          if (mag > 40) {
            // Neon cyan outlines
            edge[idx] = 0;      // R
            edge[idx+1] = 240;  // G
            edge[idx+2] = 255;  // B
            edge[idx+3] = 255;  // A
          } else {
            edge[idx+3] = 0;    // Transparent
          }
        }
      }
      
      // Draw raw image in background with low opacity, and overlay glowing edges
      this.canvasCtx.globalAlpha = 0.25;
      this.canvasCtx.drawImage(tempCanvas, 0, 0);
      this.canvasCtx.globalAlpha = 1.0;

      // Overlay neon lines
      const edgeCanvas = document.createElement('canvas');
      edgeCanvas.width = width;
      edgeCanvas.height = height;
      edgeCanvas.getContext('2d').putImageData(edgeData, 0, 0);
      
      this.canvasCtx.shadowColor = '#00f0ff';
      this.canvasCtx.shadowBlur = 10;
      this.canvasCtx.drawImage(edgeCanvas, 0, 0);
      this.canvasCtx.shadowBlur = 0; // Reset
    } else if (this.currentFilter === 'cyberpunk') {
      // Pink and cyan chromatic look
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i+1];
        const b = data[i+2];
        
        // Boost pink channels (Red + Blue) and swap channels slightly
        data[i] = Math.min(255, r * 1.3);
        data[i+1] = Math.min(255, g * 0.8);
        data[i+2] = Math.min(255, b * 1.5 + 40);
      }
      this.canvasCtx.putImageData(imgData, 0, 0);
    }
  }

  // Draw funny decorations mathematically on canvas to run self-contained without remote assets
  drawStickerOverlay() {
    if (this.currentSticker === 'none') return;

    this.canvasCtx.save();
    
    // Translate and rotate around sticker center
    this.canvasCtx.translate(this.stickerState.x, this.stickerState.y);
    this.canvasCtx.rotate((this.stickerState.rotation * Math.PI) / 180);
    this.canvasCtx.scale(this.stickerState.scale, this.stickerState.scale);

    // Render mathematical vector shapes
    if (this.currentSticker === 'mustache') {
      this.drawMustache();
    } else if (this.currentSticker === 'glasses') {
      this.drawGlasses();
    } else if (this.currentSticker === 'clown_nose') {
      this.drawClownNose();
    } else if (this.currentSticker === 'cat_ears') {
      this.drawCatEars();
    }

    this.canvasCtx.restore();
  }

  // Canvas drawing routines
  drawMustache() {
    this.canvasCtx.fillStyle = '#1a0d00'; // Dark brown
    this.canvasCtx.strokeStyle = '#000000';
    this.canvasCtx.lineWidth = 2;

    // Draw left side of mustache
    this.canvasCtx.beginPath();
    this.canvasCtx.moveTo(0, 0);
    this.canvasCtx.bezierCurveTo(-15, -15, -45, -10, -60, 10);
    this.canvasCtx.bezierCurveTo(-70, 25, -45, 20, -35, 10);
    this.canvasCtx.bezierCurveTo(-25, 0, -10, 5, 0, 0);
    this.canvasCtx.closePath();
    this.canvasCtx.fill();
    this.canvasCtx.stroke();

    // Draw right side of mustache
    this.canvasCtx.beginPath();
    this.canvasCtx.moveTo(0, 0);
    this.canvasCtx.bezierCurveTo(15, -15, 45, -10, 60, 10);
    this.canvasCtx.bezierCurveTo(70, 25, 45, 20, 35, 10);
    this.canvasCtx.bezierCurveTo(25, 0, 10, 5, 0, 0);
    this.canvasCtx.closePath();
    this.canvasCtx.fill();
    this.canvasCtx.stroke();
  }

  drawGlasses() {
    this.canvasCtx.strokeStyle = '#050508';
    this.canvasCtx.lineWidth = 8;
    this.canvasCtx.lineJoin = 'round';

    // Left Lens Frame (Round/Circular)
    this.canvasCtx.beginPath();
    this.canvasCtx.arc(-40, 0, 30, 0, Math.PI * 2);
    this.canvasCtx.stroke();
    
    // Fill lenses with a transparent tint
    this.canvasCtx.fillStyle = 'rgba(0, 240, 255, 0.25)'; // Cool glowing cyan lens
    this.canvasCtx.fill();

    // Draw glowing spiral design in left lens
    this.canvasCtx.strokeStyle = 'rgba(0, 240, 255, 0.6)';
    this.canvasCtx.lineWidth = 3;
    this.canvasCtx.beginPath();
    for (let theta = 0; theta < Math.PI * 6; theta += 0.1) {
      const r = 2 + theta * 1.3;
      const x = -40 + r * Math.cos(theta);
      const y = r * Math.sin(theta);
      if (theta === 0) this.canvasCtx.moveTo(x, y);
      else this.canvasCtx.lineTo(x, y);
    }
    this.canvasCtx.stroke();

    // Right Lens Frame
    this.canvasCtx.strokeStyle = '#050508';
    this.canvasCtx.lineWidth = 8;
    this.canvasCtx.beginPath();
    this.canvasCtx.arc(40, 0, 30, 0, Math.PI * 2);
    this.canvasCtx.stroke();
    
    this.canvasCtx.fillStyle = 'rgba(255, 0, 127, 0.25)'; // Pink lens
    this.canvasCtx.fill();

    // Spiral in right lens
    this.canvasCtx.strokeStyle = 'rgba(255, 0, 127, 0.6)';
    this.canvasCtx.lineWidth = 3;
    this.canvasCtx.beginPath();
    for (let theta = 0; theta < Math.PI * 6; theta += 0.1) {
      const r = 2 + theta * 1.3;
      const x = 40 + r * Math.cos(theta);
      const y = r * Math.sin(theta);
      if (theta === 0) this.canvasCtx.moveTo(x, y);
      else this.canvasCtx.lineTo(x, y);
    }
    this.canvasCtx.stroke();

    // Nose Bridge connecting lenses
    this.canvasCtx.strokeStyle = '#050508';
    this.canvasCtx.lineWidth = 8;
    this.canvasCtx.beginPath();
    this.canvasCtx.arc(0, -10, 15, Math.PI, 0, false);
    this.canvasCtx.stroke();

    // Frame wings/extensions on sides
    this.canvasCtx.beginPath();
    this.canvasCtx.moveTo(-70, 0);
    this.canvasCtx.lineTo(-85, -5);
    this.canvasCtx.moveTo(70, 0);
    this.canvasCtx.lineTo(85, -5);
    this.canvasCtx.stroke();
  }

  drawClownNose() {
    // Draw solid red circle
    const grad = this.canvasCtx.createRadialGradient(-10, -10, 5, 0, 0, 35);
    grad.addColorStop(0, '#ff6b6b'); // Specular light highlight point
    grad.addColorStop(0.3, '#ff0000');
    grad.addColorStop(1, '#8f0000'); // Shadow

    this.canvasCtx.fillStyle = grad;
    this.canvasCtx.beginPath();
    this.canvasCtx.arc(0, 0, 32, 0, Math.PI * 2);
    this.canvasCtx.fill();

    // Adding glare reflection
    this.canvasCtx.fillStyle = 'rgba(255, 255, 255, 0.65)';
    this.canvasCtx.beginPath();
    this.canvasCtx.ellipse(-10, -10, 8, 5, Math.PI / 4, 0, Math.PI * 2);
    this.canvasCtx.fill();
  }

  drawCatEars() {
    // Left Ear
    this.canvasCtx.fillStyle = '#050508'; // Main outer ear color
    this.canvasCtx.beginPath();
    this.canvasCtx.moveTo(-70, 0);
    this.canvasCtx.quadraticCurveTo(-75, -60, -95, -70); // Tip
    this.canvasCtx.quadraticCurveTo(-45, -55, -30, -15);
    this.canvasCtx.closePath();
    this.canvasCtx.fill();

    // Left Inner Pink Ear
    this.canvasCtx.fillStyle = '#ffb3d9';
    this.canvasCtx.beginPath();
    this.canvasCtx.moveTo(-65, -5);
    this.canvasCtx.quadraticCurveTo(-68, -48, -85, -58); // Tip
    this.canvasCtx.quadraticCurveTo(-48, -45, -38, -15);
    this.canvasCtx.closePath();
    this.canvasCtx.fill();

    // Right Ear
    this.canvasCtx.fillStyle = '#050508'; // Main outer ear
    this.canvasCtx.beginPath();
    this.canvasCtx.moveTo(70, 0);
    this.canvasCtx.quadraticCurveTo(75, -60, 95, -70); // Tip
    this.canvasCtx.quadraticCurveTo(45, -55, 30, -15);
    this.canvasCtx.closePath();
    this.canvasCtx.fill();

    // Right Inner Pink Ear
    this.canvasCtx.fillStyle = '#ffb3d9';
    this.canvasCtx.beginPath();
    this.canvasCtx.moveTo(65, -5);
    this.canvasCtx.quadraticCurveTo(68, -48, 85, -58); // Tip
    this.canvasCtx.quadraticCurveTo(48, -45, 38, -15);
    this.canvasCtx.closePath();
    this.canvasCtx.fill();
    
    // Draw a thin head band connecting them
    this.canvasCtx.strokeStyle = '#050508';
    this.canvasCtx.lineWidth = 4;
    this.canvasCtx.beginPath();
    this.canvasCtx.arc(0, 10, 45, Math.PI + 0.3, Math.PI * 2 - 0.3, false);
    this.canvasCtx.stroke();
  }
}

// Global hookup
document.addEventListener('DOMContentLoaded', () => {
  window.filterPipeline = new VideoFilterPipeline();
});
