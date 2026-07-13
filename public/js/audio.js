class VoiceGenderAnalyzer {
  constructor() {
    this.audioContext = null;
    this.analyser = null;
    this.microphone = null;
    this.javascriptNode = null;
    this.stream = null;
    this.ownsStream = false;
    this.isAnalyzing = false;
    
    // UI elements
    this.visualizerCanvas = document.getElementById('audio-visualizer');
    this.visualizerCtx = this.visualizerCanvas?.getContext('2d');
    this.genderIcon = document.getElementById('gender-icon');
    this.genderLabel = document.getElementById('gender-label');
    this.pitchReading = document.getElementById('pitch-reading');
    this.aiStatusBadge = document.getElementById('ai-status-badge');
    this.startBtn = document.getElementById('start-analysis-btn');
    this.calibrationContainer = document.getElementById('calibration-container');
    this.calibrationProgress = document.getElementById('calibration-progress');

    this.pitchHistory = [];
    this.detectedGender = 'unknown';
    this.animationFrameId = null;

    // Pitch bounds (Hz)
    this.minFreq = 75;
    this.maxFreq = 300;
    this.rmsThreshold = 0.015; // Noise threshold
  }

  async start(existingStream = null) {
    if (this.isAnalyzing) return;
    
    try {
      if (existingStream) {
        this.stream = existingStream;
        this.ownsStream = false;
      } else {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        this.ownsStream = true;
      }
      
      // Initialize Audio Context
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioContextClass();
      
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 2048;
      
      this.microphone = this.audioContext.createMediaStreamSource(this.stream);
      this.microphone.connect(this.analyser);
      
      this.isAnalyzing = true;
      this.pitchHistory = [];
      this.detectedGender = 'unknown';
      
      // Update UI state
      if (this.aiStatusBadge) {
        this.aiStatusBadge.className = 'ai-badge calibrating';
        this.aiStatusBadge.textContent = 'Calibrating';
      }
      if (this.startBtn) {
        this.startBtn.innerHTML = '<i data-lucide="refresh-cw"></i> Recalibrating...';
        lucide.createIcons();
      }
      if (this.calibrationContainer) {
        this.calibrationContainer.style.display = 'block';
        this.calibrationProgress.style.width = '0%';
      }

      // Start rendering loop and pitch extraction
      this.drawVisualizer();
      this.pitchLoop();
      
      console.log('Voice Gender Analyzer started successfully. Background analysis in progress...');
      return true;
    } catch (err) {
      console.error('Error starting voice analysis:', err);
      this.stop();
      return false;
    }
  }

  stop() {
    this.isAnalyzing = false;
    
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    
    if (this.stream && this.ownsStream) {
      this.stream.getTracks().forEach(track => track.stop());
    }
    this.stream = null;
    
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    // Reset UI
    if (this.aiStatusBadge) {
      if (this.detectedGender !== 'unknown') {
        this.aiStatusBadge.className = 'ai-badge active';
        this.aiStatusBadge.textContent = 'Active';
      } else {
        this.aiStatusBadge.className = 'ai-badge inactive';
        this.aiStatusBadge.textContent = 'Inactive';
      }
    }
    
    if (this.startBtn) {
      this.startBtn.innerHTML = '<i data-lucide="refresh-cw"></i> Recalibrate AI Voice';
      lucide.createIcons();
    }
    
    if (this.calibrationContainer) {
      this.calibrationContainer.style.display = 'none';
    }

    // Clear visualizer canvas
    if (this.visualizerCtx && this.visualizerCanvas) {
      this.visualizerCtx.clearRect(0, 0, this.visualizerCanvas.width, this.visualizerCanvas.height);
    }
  }

  // Uses Autocorrelation to extract fundamental frequency (F0)
  autoCorrelate(buffer, sampleRate) {
    // Perform root-mean-square amplitude calculation
    let rms = 0;
    for (let i = 0; i < buffer.length; i++) {
      rms += buffer[i] * buffer[i];
    }
    rms = Math.sqrt(rms / buffer.length);
    
    // Insufficient signal (silence)
    if (rms < this.rmsThreshold) {
      return -1;
    }

    // Clip signal using center clipping (improves pitch accuracy)
    let r1 = 0, r2 = buffer.length - 1;
    const thres = 0.2;
    for (let i = 0; i < buffer.length / 2; i++) {
      if (Math.abs(buffer[i]) < thres) buffer[i] = 0;
    }

    // Autocorrelation
    const r = new Float32Array(buffer.length);
    for (let lag = 0; lag < buffer.length / 2; lag++) {
      let sum = 0;
      for (let i = 0; i < buffer.length / 2; i++) {
        sum += buffer[i] * buffer[i + lag];
      }
      r[lag] = sum;
    }

    // Find peak within human speech pitch boundaries (75Hz to 300Hz)
    // lag = sampleRate / frequency
    const maxLag = Math.floor(sampleRate / this.minFreq);
    const minLag = Math.floor(sampleRate / this.maxFreq);
    
    let bestLag = -1;
    let maxVal = -Infinity;

    // Search for local peak
    for (let lag = minLag; lag <= maxLag; lag++) {
      // Look for peaks: local maxima greater than neighbors and threshold
      if (r[lag] > r[lag - 1] && r[lag] > r[lag + 1]) {
        if (r[lag] > maxVal) {
          maxVal = r[lag];
          bestLag = lag;
        }
      }
    }

    if (bestLag > -1) {
      const frequency = sampleRate / bestLag;
      return frequency;
    }
    
    return -1;
  }

  pitchLoop() {
    if (!this.isAnalyzing) return;

    const bufferLength = this.analyser.fftSize;
    const dataArray = new Float32Array(bufferLength);
    this.analyser.getFloatTimeDomainData(dataArray);

    const pitch = this.autoCorrelate(dataArray, this.audioContext.sampleRate);
    
    if (pitch > 0 && pitch >= this.minFreq && pitch <= this.maxFreq) {
      this.pitchReading.textContent = `${Math.round(pitch)} Hz`;
      this.pitchHistory.push(pitch);
      
      // Update calibration progress
      const targetReadings = 50; // number of stable readings required to finish calibration
      const progressPercent = Math.min((this.pitchHistory.length / targetReadings) * 100, 100);
      if (this.calibrationProgress) {
        this.calibrationProgress.style.width = `${progressPercent}%`;
      }

      // Once we have collected enough stable readings, classify the user
      if (this.pitchHistory.length >= targetReadings) {
        this.classifyGender();
        this.stop(); // Stop calibration once complete
        return;
      }
    } else {
      this.pitchReading.textContent = '--- Hz';
    }

    setTimeout(() => this.pitchLoop(), 50);
  }

  classifyGender() {
    if (this.pitchHistory.length === 0) return;

    // Filter outliers (keep only middle 80%)
    const sorted = [...this.pitchHistory].sort((a, b) => a - b);
    const lowIdx = Math.floor(sorted.length * 0.1);
    const highIdx = Math.floor(sorted.length * 0.9);
    const trimmed = sorted.slice(lowIdx, highIdx);

    const averagePitch = trimmed.reduce((sum, val) => sum + val, 0) / trimmed.length;
    console.log('Voice calibration complete. Average F0 Pitch:', averagePitch);

    // AI Classification logic
    // Median human pitch: Male (85Hz - 165Hz), Female (165Hz - 255Hz)
    // We add some fuzzy boundaries
    if (averagePitch >= 80 && averagePitch <= 165) {
      this.detectedGender = 'male';
    } else if (averagePitch > 165 && averagePitch <= 280) {
      this.detectedGender = 'female';
    } else {
      this.detectedGender = 'unknown';
    }

    this.updateGenderUI();

    // Trigger callback to save profile details on server
    if (window.onVoiceAnalyzerComplete) {
      window.onVoiceAnalyzerComplete(this.detectedGender);
    }
  }

  updateGenderUI() {
    if (!this.genderLabel || !this.genderIcon) return;

    this.genderIcon.className = 'voice-gender-icon';
    this.genderIcon.innerHTML = '';

    if (this.detectedGender === 'male') {
      this.genderIcon.classList.add('male');
      this.genderIcon.innerHTML = '<i data-lucide="user"></i>';
      this.genderLabel.textContent = 'Male (AI Identified)';
      this.genderLabel.style.color = '#3b82f6';
    } else if (this.detectedGender === 'female') {
      this.genderIcon.classList.add('female');
      this.genderIcon.innerHTML = '<i data-lucide="user-round"></i>';
      this.genderLabel.textContent = 'Female (AI Identified)';
      this.genderLabel.style.color = '#ec4899';
    } else {
      this.genderIcon.innerHTML = '<i data-lucide="help-circle"></i>';
      this.genderLabel.textContent = 'Calibrate again';
      this.genderLabel.style.color = 'var(--text-secondary)';
    }
    
    lucide.createIcons();
  }

  drawVisualizer() {
    if (!this.isAnalyzing || !this.visualizerCanvas || !this.visualizerCtx) return;

    this.animationFrameId = requestAnimationFrame(() => this.drawVisualizer());

    // Auto-resize canvas if container width changes
    const dpr = window.devicePixelRatio || 1;
    const rect = this.visualizerCanvas.getBoundingClientRect();
    if (this.visualizerCanvas.width !== rect.width * dpr || this.visualizerCanvas.height !== rect.height * dpr) {
      this.visualizerCanvas.width = rect.width * dpr;
      this.visualizerCanvas.height = rect.height * dpr;
      this.visualizerCtx.scale(dpr, dpr);
    }

    const width = rect.width;
    const height = rect.height;
    
    this.visualizerCtx.fillStyle = 'rgba(10, 11, 16, 0.4)';
    this.visualizerCtx.fillRect(0, 0, width, height);

    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    this.analyser.getByteFrequencyData(dataArray);

    // Draw stylish frequency neon bar graph
    const barWidth = (width / 40) - 2;
    let barHeight;
    let x = 0;

    for (let i = 0; i < 40; i++) {
      // Focus on lower speech ranges (index 0 to 80 of spectrum)
      const dataIndex = Math.floor(i * 1.5);
      barHeight = (dataArray[dataIndex] / 255) * height * 0.8;

      // Color gradient transition from Cyan to Purple
      const percent = i / 40;
      this.visualizerCtx.fillStyle = `rgba(${Math.floor(0 + percent * 189)}, ${Math.floor(240 - percent * 240)}, 255, 0.8)`;
      
      // Draw rounded ends
      this.visualizerCtx.beginPath();
      this.visualizerCtx.roundRect(x, height - barHeight - 4, barWidth, barHeight + 4, 3);
      this.visualizerCtx.fill();

      x += barWidth + 2;
    }
  }
}

// Global hookup
document.addEventListener('DOMContentLoaded', () => {
  const analyzer = new VoiceGenderAnalyzer();
  const startBtn = document.getElementById('start-analysis-btn');

  if (startBtn) {
    // Set text to indicate recalibration, since the primary analysis runs automatically in the background
    startBtn.innerHTML = '<i data-lucide="refresh-cw"></i> Recalibrate AI Voice';
    lucide.createIcons();
    
    startBtn.addEventListener('click', () => {
      // Clear states and reset interface
      analyzer.detectedGender = 'unknown';
      analyzer.pitchHistory = [];
      analyzer.updateGenderUI();
      analyzer.stop();

      // Retrieve the existing active microphone stream to avoid prompt collision
      let activeStream = null;
      if (window.filterPipeline) {
        if (window.filterPipeline.isUsingFallback && window.filterPipeline.fallbackAudioTrack) {
          activeStream = new MediaStream([window.filterPipeline.fallbackAudioTrack]);
        } else if (window.filterPipeline.stream) {
          activeStream = window.filterPipeline.stream;
        }
      }
      
      analyzer.start(activeStream);
    });
  }

  // Export analyzer instance to window
  window.voiceAnalyzer = analyzer;
});
