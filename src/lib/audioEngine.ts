import { audioProcessorCode } from './processor';
import toWav from 'audiobuffer-to-wav';
import lamejs from './lame.all.js';

export class AudioEngine {
  ctx: AudioContext;
  analyserDry: AnalyserNode;
  analyserWet: AnalyserNode;
  dryGain: GainNode;
  wetGain: GainNode;
  makeupGainNode: GainNode;
  compressor: DynamicsCompressorNode;
  masterGain: GainNode;
  lufsGainNode: GainNode;
  limiter: DynamicsCompressorNode;
  dcBlock: BiquadFilterNode;
  clipper: WaveShaperNode;
  normalizationGain: number = 1.0;
  dryGainProxy: GainNode;
  wetGainProxy: GainNode;
  workletNode: AudioWorkletNode | null = null;
  onReduction: ((total: number, esser: number) => void) | null = null;
  deEsserFilter: BiquadFilterNode | null = null;
  lookaheadDelay: DelayNode | null = null;
  sourceNode: AudioBufferSourceNode | null = null;
  sibilanceGainNode: GainNode | null = null;
  audioBuffer: AudioBuffer | null = null;

  // Mastering EQ & Saturation Nodes
  eqFilters: BiquadFilterNode[] = [];
  saturator: WaveShaperNode | null = null;
  saturatorGain: GainNode | null = null;
  saturatorCrossover: BiquadFilterNode | null = null;
  
  sibilancePoints: Array<{id: string, time: number, duration: number, gain: number, peak: number, width: number}> = [];

  private analyzerNode: AnalyserNode | null = null;
  private levelBuffer: Float32Array | null = null;

  private mixValue = 1; // 0: Dry, 1: Wet
  private isPlaying = false;
  private startOffset = 0;
  private startTime = 0;

  private isWorkletLoaded = false;
  private initPromise: Promise<void> | null = null;

  private currentParams = {
    gateThreshold: 0.02,
    gateRatio: 4,
    deEsserThreshold: 0.05,
    deEsserAmount: 0.5,
    deEsserFreq: 5000,
    compThreshold: -24,
    compRatio: 4,
    saturation: 0,
    eq: [
      { freq: 100, gain: 0, q: 1, type: 'lowshelf' as BiquadFilterType },
      { freq: 1000, gain: 0, q: 1, type: 'peaking' as BiquadFilterType },
      { freq: 4000, gain: 0, q: 1, type: 'peaking' as BiquadFilterType },
      { freq: 12000, gain: 0, q: 1, type: 'highshelf' as BiquadFilterType }
    ]
  };

  constructor() {
    this.ctx = new AudioContext();
    
    this.analyzerNode = this.ctx.createAnalyser();
    this.analyzerNode.fftSize = 2048; // Increased from 256 for better RMS/PLR estimation
    this.levelBuffer = new Float32Array(this.analyzerNode.fftSize);

    // Separate analysers for Dry(Red) and Wet(Blue)
    this.analyserDry = this.ctx.createAnalyser();
    this.analyserDry.fftSize = 2048;
    this.analyserDry.smoothingTimeConstant = 0.85;

    this.analyserWet = this.ctx.createAnalyser();
    this.analyserWet.fftSize = 2048;
    this.analyserWet.smoothingTimeConstant = 0.85;
    
    this.dryGain = this.ctx.createGain();
    this.wetGain = this.ctx.createGain();
    this.makeupGainNode = this.ctx.createGain();
    this.compressor = this.ctx.createDynamicsCompressor();
    this.masterGain = this.ctx.createGain();
    this.lufsGainNode = this.ctx.createGain();
    this.limiter = this.ctx.createDynamicsCompressor();
    this.dcBlock = this.ctx.createBiquadFilter();
    this.clipper = this.ctx.createWaveShaper();
    
    // DC Block (Highpass at 20Hz)
    this.dcBlock.type = 'highpass';
    this.dcBlock.frequency.value = 20;

    // Soft Clipper for Transparent Peak Protection
    const n_samples = 44100;
    const curve = new Float32Array(n_samples);
    for (let i = 0; i < n_samples; ++i) {
      const x = (i * 2) / n_samples - 1;
      // Tanh-based soft saturation for a natural analog-like clip
      // This prevents the "crackling" while still protecting against 0dB overs
      curve[i] = Math.tanh(x * 1.05) / 1.05; 
    }
    this.clipper.curve = curve;
    
    // Default compressor settings for mastering
    this.compressor.threshold.value = -24;
    this.compressor.knee.value = 30;
    this.compressor.ratio.value = 4;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.25;

    // Professional Brickwall Limiter Settings (Prevent Inter-Sample Peaks)
    this.limiter.threshold.value = -1.2; // Stricter ceiling for inter-sample safety
    this.limiter.knee.value = 0; // Absolute hard knee
    this.limiter.ratio.value = 50; // Maximum effective ratio
    this.limiter.attack.value = 0; // Zero attack for instantaneous peak protection
    this.limiter.release.value = 0.1;

    // Connect to analysers regardless of mix (to always show both)
    // We create isolated proxy gains so the analysers always get full volume
    // even if the master speaker output is crossfaded.
    this.dryGainProxy = this.ctx.createGain();
    this.wetGainProxy = this.ctx.createGain();

    // --- Processing Nodes Initialization ---
    this.saturatorCrossover = this.ctx.createBiquadFilter();
    this.saturatorCrossover.type = 'highpass';
    this.saturatorCrossover.frequency.value = 3000;

    this.saturator = this.ctx.createWaveShaper();
    this.saturator.curve = this.makeSaturationCurve(this.currentParams.saturation);

    this.saturatorGain = this.ctx.createGain();
    this.saturatorGain.gain.value = 0; // Starts at zero to prevent signal doubling and phase artifacts

    this.eqFilters = this.currentParams.eq.map(conf => {
      const f = this.ctx.createBiquadFilter();
      f.type = conf.type;
      f.frequency.value = conf.freq;
      f.gain.value = conf.gain;
      f.Q.value = conf.q;
      return f;
    });

    const finalMerge = this.ctx.createGain();

    // --- Routing ---
    this.dryGain.connect(finalMerge); // Dry bypasses processing
    this.wetGain.connect(this.makeupGainNode);
    this.makeupGainNode.connect(this.compressor); // Wet goes through processing
    
    let eqInput: AudioNode = this.compressor;
    this.eqFilters.forEach(f => {
      eqInput.connect(f);
      eqInput = f;
    });

    // Exciter (Saturation) parallel path from compressor
    this.compressor.connect(this.saturatorCrossover);
    this.saturatorCrossover.connect(this.saturator!);
    this.saturator!.connect(this.saturatorGain);

    // Final merge: EQed signal + Bypassed Dry + Parallel Saturation
    eqInput.connect(finalMerge);
    this.saturatorGain.connect(finalMerge);

    finalMerge.connect(this.dcBlock);
    this.dcBlock.connect(this.limiter);
    this.limiter.connect(this.clipper);
    this.clipper.connect(this.analyzerNode!);
    this.analyzerNode!.connect(this.masterGain);
    this.masterGain.connect(this.ctx.destination);
    
    this.setMix(1); // default full wet
  }

  private makeSaturationCurve(amount: number) {
    const n_samples = 44100;
    const curve = new Float32Array(n_samples);
    const k = amount * 10;
    for (let i = 0; i < n_samples; ++i) {
      const x = (i * 2) / n_samples - 1;
      // Soft clipping / Sigmoid-like saturation
      if (k === 0) {
        curve[i] = x;
      } else {
        curve[i] = (1 + k) * x / (1 + k * Math.abs(x));
      }
    }
    return curve;
  }

  async init() {
    if (this.isWorkletLoaded) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      // Do not await ctx.resume() here as it can freeze indefinitely if called without user gesture (e.g. on mount).
      // AudioWorklet.addModule works perfectly fine even if AudioContext is suspended.
      const blob = new Blob([audioProcessorCode], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      try {
        await this.ctx.audioWorklet.addModule(url);
        this.isWorkletLoaded = true;
      } catch (e) {
        console.error("AudioWorklet initialization failed", e);
        throw e;
      }
    })();

    return this.initPromise;
  }

  async resumeContext() {
    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch (e) {
        console.warn("AudioContext resume failed. Waiting for user interaction.");
      }
    }
  }

  async loadAudio(file: File): Promise<AudioBuffer> {
    await this.resumeContext();
    await this.init(); // ensure init completes on user upload gesture
    const arrayBuffer = await file.arrayBuffer();
    this.audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
    this.sibilancePoints = await this.analyzeSibilance(this.audioBuffer);
    this.normalizationGain = 1.0;
    this.lufsGainNode.gain.setValueAtTime(1.0, this.ctx.currentTime);
    return this.audioBuffer;
  }

  // Calculate Integrated LUFS (Simplified BS.1770)
  async calculateLUFS(buffer: AudioBuffer): Promise<number> {
    const sampleRate = buffer.sampleRate;
    const channels = buffer.numberOfChannels;
    
    const offlineCtx = new OfflineAudioContext(channels, buffer.length, sampleRate);
    const source = offlineCtx.createBufferSource();
    source.buffer = buffer;

    // Stage 1: Pre-filter (high shelf)
    const preFilter = offlineCtx.createBiquadFilter();
    preFilter.type = 'highshelf';
    preFilter.frequency.value = 1681.97;
    preFilter.gain.value = 3.9998;
    preFilter.Q.value = 0.7071;

    // Stage 2: RLB filter (high pass)
    const rlbFilter = offlineCtx.createBiquadFilter();
    rlbFilter.type = 'highpass';
    rlbFilter.frequency.value = 38.13;
    rlbFilter.Q.value = 0.7071;

    source.connect(preFilter);
    preFilter.connect(rlbFilter);
    rlbFilter.connect(offlineCtx.destination);
    
    source.start(0);
    const filteredBuffer = await offlineCtx.startRendering();
    
    // O(N) optimized calculation
    let totalPower = 0;
    let validSamples = 0;
    const absThreshold = 1e-7; // -70 LKFS threshold

    for (let c = 0; c < channels; c++) {
      const data = filteredBuffer.getChannelData(c);
      const dataLen = data.length;
      let channelPower = 0;
      let channelValidCount = 0;
      
      for (let i = 0; i < dataLen; i++) {
        const val = data[i];
        const sq = val * val;
        if (sq > absThreshold) {
          channelPower += sq;
          channelValidCount++;
        }
      }
      
      if (channelValidCount > 0) {
        totalPower += (channelPower / channelValidCount);
        validSamples++;
      }
    }

    if (validSamples === 0) return -Infinity;

    // Mean of channel powers
    const avgPower = totalPower / validSamples;
    const lufs = -0.691 + 10 * Math.log10(Math.max(avgPower, 1e-12));
    
    // Safety Guard: Don't return -Infinity for very quiet/silent files to prevent Infinity gains later
    return Math.max(lufs, -99);
  }

  async applyNormalization(targetLUFS: number) {
    if (!this.audioBuffer) return 0;
    const currentLUFS = await this.calculateLUFS(this.audioBuffer);
    const gainDb = targetLUFS - currentLUFS;
    const gainFactor = Math.pow(10, gainDb / 20);
    this.normalizationGain = gainFactor;
    this.lufsGainNode.gain.setTargetAtTime(gainFactor, this.ctx.currentTime, 0.1);
    return currentLUFS;
  }

  async smartOptimize(target: -14 | -16 = -14): Promise<{ 
    lufs: number, 
    gain: number, 
    compThreshold: number,
    compRatio: number,
    saturation: number,
    eq: {index: number, freq: number, gain: number, q: number}[]
  }> {
    if (!this.audioBuffer) throw new Error("No audio loaded for optimization");
    
    // 1. Analyze current loudness
    const currentLUFS = await this.calculateLUFS(this.audioBuffer);
    
    // Safety Guard: Fatal error for silent or near-silent files to prevent Gain Infinity
    if (currentLUFS < -90) {
      throw new Error("입력 신호가 너무 작아 최적화를 진행할 수 없습니다. (Signal too low)");
    }
    
    // 2. Calibrated target logic 
    // Target is now tuned to hit EXACTly -14 or -16 to avoid "Too Quiet" warnings,
    // while keeping high PLR (>9.0) for professional DAW readiness.
    const targetLUFS = target === -14 ? -15.2 : -17.2; 
    let gainDb = targetLUFS - currentLUFS;
    
    // Absolute Ceiling: Never allow gain boost more than 40dB to prevent noise explosion
    gainDb = Math.min(40, gainDb);
    const gainValue = Math.pow(10, gainDb / 20);
    
    // 3. Recommended EQ Profiling (Surgical Prep)
    const eqRecommendations = [
      { index: 0, freq: 70, gain: 2.0, q: 0.5 }, // Solid sub-foundation
      { index: 1, freq: 350, gain: -4.0, q: 0.6 }, // CLEAN MUD (Targeting Vocal Masking Reported in Mode A)
      { index: 2, freq: 3500, gain: 1.8, q: 0.7 }, // Presence definition
      { index: 3, freq: 7500, gain: 1.0, q: 0.5 } // Tone down high-end boost from 2.5 to 1.0 to avoid "metallic" crunch
    ];

    return { 
      lufs: currentLUFS, 
      gain: gainValue, 
      compThreshold: -16, // Slightly lower for more consistent density
      compRatio: 2.0, // Keeping it dynamic for DAW pre-mastering
      saturation: 0, 
      eq: eqRecommendations
    };
  }

  async analyzeSibilance(buffer: AudioBuffer) {
    const offlineCtx = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    const source = offlineCtx.createBufferSource();
    source.buffer = buffer;
    
    // Create multiple bandpass filters from 5000Hz to 8500Hz
    const freqs = [5000, 5800, 6600, 7400, 8200];
    const sumNode = offlineCtx.createGain();
    // Reduce gain per filter to avoid clipping the sum
    sumNode.gain.value = 1.0 / freqs.length;

    freqs.forEach(freq => {
      const filter = offlineCtx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = freq;
      filter.Q.value = 2.5; // Narrower band for specific sibilance detection
      source.connect(filter);
      filter.connect(sumNode);
    });
    
    sumNode.connect(offlineCtx.destination);
    source.start(0);
    
    const hpBuffer = await offlineCtx.startRendering();
    const channelData = hpBuffer.getChannelData(0); 
    const sampleRate = hpBuffer.sampleRate;
    const windowSize = Math.floor(sampleRate * 0.01); 
    
    // Adaptive thresholding: Find the peak energy in the high-passed band first
    let maxRms = 0;
    for (let i = 0; i < channelData.length; i += windowSize) {
      let sum = 0;
      const len = Math.min(windowSize, channelData.length - i);
      for (let j = 0; j < len; j++) sum += channelData[i + j] * channelData[i + j];
      const rms = Math.sqrt(sum / len);
      if (rms > maxRms) maxRms = rms;
    }

    const points = [];
    let inSibilance = false;
    let sibilanceStart = 0;
    let peak = 0;
    
    // Set threshold at 7% of the detected max high-frequency energy (Sensitive catch)
    const threshold = Math.max(0.000003, maxRms * 0.07); 

    for (let i = 0; i < channelData.length; i += (windowSize / 2)) { // 50% overlap for better transient catch
      let sum = 0;
      const len = Math.min(windowSize, channelData.length - i);
      for (let j = 0; j < len; j++) {
        sum += channelData[i + j] * channelData[i + j];
      }
      const rms = Math.sqrt(sum / len);
      
      if (rms > threshold) {
        if (!inSibilance) {
          inSibilance = true;
          sibilanceStart = i;
          peak = rms;
        } else {
          if (rms > peak) peak = rms;
        }
      } else {
        if (inSibilance) {
          inSibilance = false;
          if ((i - sibilanceStart) > sampleRate * 0.005) { // Any transient over 5ms
             const time = (sibilanceStart + (i - sibilanceStart) / 2) / sampleRate;
             points.push({
               id: Math.random().toString(36).substring(2, 11),
               time: time,
               width: (i - sibilanceStart) / sampleRate,
               peak: peak,
               gain: 1.0 
             });
          }
        }
      }
    }

    if (inSibilance && (channelData.length - sibilanceStart) > sampleRate * 0.02) {
      const i = channelData.length;
      const time = (sibilanceStart + (i - sibilanceStart) / 2) / sampleRate;
      points.push({
        id: Math.random().toString(36).substring(2, 11),
        time: time,
        width: (i - sibilanceStart) / sampleRate,
        peak: peak,
        gain: 1.0 
      });
    }

    return points;
  }

  buildGraph() {
    if (!this.audioBuffer) return;
    if (!this.isWorkletLoaded) {
      console.error("Graph build attempted before worklet was loaded.");
      return;
    }
    
    // Stop existing source if any
    if (this.sourceNode) {
      this.sourceNode.onended = null;
      try { this.sourceNode.stop(); } catch(e) {}
      this.sourceNode.disconnect();
    }
    if (this.workletNode) this.workletNode.disconnect();
    if (this.deEsserFilter) this.deEsserFilter.disconnect();
    if (this.lookaheadDelay) this.lookaheadDelay.disconnect();
    if (this.sibilanceGainNode) this.sibilanceGainNode.disconnect();

    this.sourceNode = this.ctx.createBufferSource();
    this.sourceNode.buffer = this.audioBuffer;

    this.lookaheadDelay = this.ctx.createDelay(1.0);
    this.lookaheadDelay.delayTime.value = 0.005; // 5ms lookahead

    // Normalize FIRST: Source -> lufsGainNode
    // This allows both paths and all internal processing to work at a standard volume level.
    this.sourceNode.connect(this.lufsGainNode);
    this.lufsGainNode.connect(this.lookaheadDelay);

    // After normalization and delay: Split to Dry and Wet paths
    this.lookaheadDelay.connect(this.dryGain);
    this.lookaheadDelay.connect(this.wetGain);
    this.workletNode = new AudioWorkletNode(this.ctx, 'vocal-processor', {
      numberOfInputs: 2,
      numberOfOutputs: 1,
      outputChannelCount: [this.audioBuffer.numberOfChannels]
    });

    this.workletNode.port.onmessage = (e) => {
      if (e.data.type === 'reduction' && this.onReduction) {
        this.onReduction(e.data.totalReduction, e.data.esserReduction);
      }
    };

    this.workletNode.parameters.get('gateThreshold')?.setValueAtTime(this.currentParams.gateThreshold, this.ctx.currentTime);
    this.workletNode.parameters.get('gateRatio')?.setValueAtTime(this.currentParams.gateRatio, this.ctx.currentTime);
    this.workletNode.parameters.get('deEsserThreshold')?.setValueAtTime(this.currentParams.deEsserThreshold, this.ctx.currentTime);
    this.workletNode.parameters.get('deEsserAmount')?.setValueAtTime(this.currentParams.deEsserAmount, this.ctx.currentTime);

    this.deEsserFilter = this.ctx.createBiquadFilter();
    this.deEsserFilter.type = 'highpass';
    this.deEsserFilter.frequency.value = this.currentParams.deEsserFreq;

    this.sibilanceGainNode = this.ctx.createGain();

    // Crossover for manual de-essing to preserve low frequencies (vocal body)
    const crossoverLow = this.ctx.createBiquadFilter();
    crossoverLow.type = 'lowpass';
    crossoverLow.frequency.value = 4000;
    crossoverLow.Q.value = 0.5; // Linkwitz-Riley approximation

    const crossoverHigh = this.ctx.createBiquadFilter();
    crossoverHigh.type = 'highpass';
    crossoverHigh.frequency.value = 4000;
    crossoverHigh.Q.value = 0.5;

    // Routing
    // Input 0: Delayed signal (Dry audio to be processed)
    this.lookaheadDelay.connect(this.workletNode, 0, 0);
    this.lookaheadDelay.connect(this.dryGainProxy); // Send full dry to analyser
    this.dryGainProxy.connect(this.analyserDry);

    // Input 1: Sibilance detection signal (High-passed, not delayed)
    this.sourceNode.connect(this.deEsserFilter);
    this.deEsserFilter.connect(this.workletNode, 0, 1);

    // Output routing (Split Band)
    this.workletNode.connect(crossoverLow);
    this.workletNode.connect(crossoverHigh);

    // Proxy node to collect full processed signal
    const wetSum = this.ctx.createGain();

    // Low band bypasses sibilance ducking
    crossoverLow.connect(wetSum);

    // High band goes through manual sibilance ducking
    crossoverHigh.connect(this.sibilanceGainNode);
    this.sibilanceGainNode.connect(wetSum);
    
    // Distribute wetSum to speakers (via crossfader) and visualizer
    wetSum.connect(this.wetGain);
    wetSum.connect(this.wetGainProxy);
    this.wetGainProxy.connect(this.analyserWet);

    // Handle end of playback
    const currentNode = this.sourceNode;
    this.sourceNode.onended = () => {
      if (this.sourceNode === currentNode) {
        this.isPlaying = false;
      }
    };
  }

  play() {
    if (!this.audioBuffer) return;
    if (this.isPlaying) return;

    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    this.buildGraph();

    this.sourceNode!.start(0, this.startOffset);
    this.startTime = this.ctx.currentTime - this.startOffset;
    this.isPlaying = true;
    
    this.scheduleSibilanceGains(this.startOffset);
  }

  scheduleSibilanceGains(offset: number) {
    if (!this.sibilanceGainNode) return;
    const now = this.ctx.currentTime;
    
    // Robust cancellation of future points to prevent pops when updating mid-playback
    try {
      this.sibilanceGainNode.gain.cancelAndHoldAtTime(now);
    } catch (e) {
      this.sibilanceGainNode.gain.cancelScheduledValues(now);
      this.sibilanceGainNode.gain.setValueAtTime(this.sibilanceGainNode.gain.value, now);
    }

    const relevantPoints = this.sibilancePoints
      .filter(pt => pt.time + (pt.width / 2) > offset)
      .sort((a, b) => a.time - b.time);
    
    let lastScheduledEndTime = now + 0.01;

    for (const pt of relevantPoints) {
      if (pt.gain >= 0.999) continue;

      const scheduleTime = now + (pt.time - offset);
      const halfWidth = pt.width / 2;
      const startTime = scheduleTime - halfWidth;
      const endTime = scheduleTime + halfWidth;

      // Anti-Overlap Guard with safety buffer
      if (startTime <= lastScheduledEndTime + 0.005) continue;
      if (endTime <= now + 0.005) continue;

      try {
        this.sibilanceGainNode.gain.linearRampToValueAtTime(1.0, startTime);
        this.sibilanceGainNode.gain.linearRampToValueAtTime(pt.gain, scheduleTime);
        this.sibilanceGainNode.gain.linearRampToValueAtTime(1.0, endTime);
        lastScheduledEndTime = endTime;
      } catch (e) {
        // Safe skip
      }
    }
  }

  updateSibilancePoints(points: any[]) {
    this.sibilancePoints = points;
    if (this.isPlaying) {
      this.scheduleSibilanceGains(this.ctx.currentTime - this.startTime);
    }
  }

  pause() {
    if (this.sourceNode) {
      this.sourceNode.onended = null;
      try { this.sourceNode.stop(); } catch(e) {}
    }
    if (this.isPlaying) {
      this.startOffset = this.ctx.currentTime - this.startTime;
    }
    this.isPlaying = false;
  }

  clear() {
    this.pause();
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    this.audioBuffer = null;
    this.sibilancePoints = [];
    this.normalizationGain = 1.0;
    this.startOffset = 0;
    this.startTime = 0;
    this.isPlaying = false;
  }

  seek(time: number) {
    const wasPlaying = this.isPlaying;
    if (this.isPlaying) {
      this.pause();
    }
    this.startOffset = Math.max(0, Math.min(time, this.audioBuffer?.duration || 0));
    if (wasPlaying) {
      this.play();
    }
  }

  // Crossfade between A (Dry) and B (Wet)
  setMix(value: number) {
    this.mixValue = Math.max(0, Math.min(1, value));
    const now = this.ctx.currentTime;
    // Equal power crossfade with smoothed transitions (50ms time constant) to prevent pops
    this.dryGain.gain.setTargetAtTime(Math.cos(this.mixValue * 0.5 * Math.PI), now, 0.05);
    this.wetGain.gain.setTargetAtTime(Math.cos((1.0 - this.mixValue) * 0.5 * Math.PI), now, 0.05);
  }

  setMasterVolume(val: number) {
    this.masterGain.gain.setTargetAtTime(val, this.ctx.currentTime, 0.05);
  }

  // Parameter Setters
  setGateThreshold(val: number) {
    this.currentParams.gateThreshold = val;
    if (this.workletNode) {
      const p = this.workletNode.parameters.get('gateThreshold');
      if (p) p.setTargetAtTime(val, this.ctx.currentTime, 0.05);
    }
  }

  setGateRatio(val: number) {
    this.currentParams.gateRatio = val;
    if (this.workletNode) {
      const p = this.workletNode.parameters.get('gateRatio');
      if (p) p.setTargetAtTime(val, this.ctx.currentTime, 0.05);
    }
  }

  setGateBypass(bypass: boolean) {
    if (this.workletNode) {
      const p = this.workletNode.parameters.get('gateBypass');
      if (p) p.setValueAtTime(bypass ? 1 : 0, this.ctx.currentTime);
    }
  }

  setDeEsserThreshold(val: number) {
    this.currentParams.deEsserThreshold = val;
    if (this.workletNode) {
      const p = this.workletNode.parameters.get('deEsserThreshold');
      if (p) p.setTargetAtTime(val, this.ctx.currentTime, 0.05);
    }
  }

  setDeEsserAmount(val: number) {
    this.currentParams.deEsserAmount = val;
    if (this.workletNode) {
      const p = this.workletNode.parameters.get('deEsserAmount');
      if (p) p.setTargetAtTime(val, this.ctx.currentTime, 0.05);
    }
  }

  setDeEsserBypass(bypass: boolean) {
    if (this.workletNode) {
      const p = this.workletNode.parameters.get('deEsserBypass');
      if (p) p.setTargetAtTime(bypass ? 1 : 0, this.ctx.currentTime, 0.05);
    }
  }

  setDeEsserFreq(freq: number) {
    this.currentParams.deEsserFreq = freq;
    if (this.deEsserFilter) {
      this.deEsserFilter.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.05);
    }
  }

  setMakeupGain(val: number) {
    this.makeupGainNode.gain.setTargetAtTime(val, this.ctx.currentTime, 0.05);
  }

  getRealtimeLevels() {
    if (!this.analyzerNode || !this.levelBuffer) return { peak: 0, rms: 0 };
    this.analyzerNode.getFloatTimeDomainData(this.levelBuffer);
    
    let sumSquares = 0;
    let peak = 0;
    for (let i = 0; i < this.levelBuffer.length; i++) {
      const val = this.levelBuffer[i];
      sumSquares += val * val;
      const absVal = Math.abs(val);
      if (absVal > peak) peak = absVal;
    }
    
    const rms = Math.sqrt(sumSquares / this.levelBuffer.length);
    return { peak, rms };
  }

  setSaturation(val: number) {
    this.currentParams.saturation = val;
    if (this.saturator) {
      this.saturator.curve = this.makeSaturationCurve(val);
      // Link parallel gain to saturation amount for a dry/wet blend character
      if (this.saturatorGain) {
        this.saturatorGain.gain.setTargetAtTime(val * 0.5, this.ctx.currentTime, 0.05);
      }
    }
  }

  setEQParam(index: number, freq?: number, gain?: number, q?: number) {
    const fNode = this.eqFilters[index];
    if (!fNode) return;
    const config = this.currentParams.eq[index];
    const now = this.ctx.currentTime;
    if (freq !== undefined) {
      config.freq = freq;
      fNode.frequency.setTargetAtTime(freq, now, 0.05);
    }
    if (gain !== undefined) {
      config.gain = gain;
      fNode.gain.setTargetAtTime(gain, now, 0.05);
    }
    if (q !== undefined) {
      config.q = q;
      fNode.Q.setTargetAtTime(q, now, 0.05);
    }
  }

  setCompThreshold(val: number) {
    this.currentParams.compThreshold = val;
    this.compressor.threshold.setTargetAtTime(val, this.ctx.currentTime, 0.05);
  }

  setCompRatio(val: number) {
    this.currentParams.compRatio = val;
    this.compressor.ratio.setTargetAtTime(val, this.ctx.currentTime, 0.05);
  }

  setCompBypass(bypass: boolean) {
    this.compressor.ratio.setTargetAtTime(bypass ? 1 : this.currentParams.compRatio, this.ctx.currentTime, 0.05);
  }

  setExciterBypass(bypass: boolean) {
    if (this.saturatorGain) {
      this.saturatorGain.gain.setTargetAtTime(bypass ? 0 : 0.5, this.ctx.currentTime, 0.05);
    }
  }

  async exportOffline(
    gateThresh: number, 
    gateRatio: number, 
    essThresh: number, 
    essAmt: number, 
    essFreq: number, 
    makeupGain: number,
    compThresh: number,
    compRatio: number,
    saturation: number,
    eqParams: {freq: number, gain: number, q: number, type: BiquadFilterType}[],
    mix: number,
    format: 'wav' | 'mp3' = 'wav',
    bitrate: number = 320,
    onProgress: (p: number) => void = () => {},
    useGate: boolean = true,
    useDeEsser: boolean = true,
    useExciter: boolean = true,
    useComp: boolean = true
  ): Promise<Blob> {
    if (!this.audioBuffer) throw new Error("No audio loaded");

    const sampleRate = 44100; // Standardize export to 44.1kHz to prevent lamejs crashes
    const length = Math.ceil(this.audioBuffer.duration * sampleRate);
    const offlineCtx = new OfflineAudioContext(2, length, sampleRate);

    // Register worklet
    const blob = new Blob([audioProcessorCode], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    await offlineCtx.audioWorklet.addModule(url);

    const offlineSource = offlineCtx.createBufferSource();
    offlineSource.buffer = this.audioBuffer;

    const workletNode = new AudioWorkletNode(offlineCtx, 'vocal-processor', {
      numberOfInputs: 2,
      numberOfOutputs: 1,
      outputChannelCount: [this.audioBuffer.numberOfChannels],
      parameterData: {
        gateThreshold: gateThresh,
        gateRatio: gateRatio,
        gateBypass: useGate ? 0 : 1,
        deEsserThreshold: essThresh,
        deEsserAmount: essAmt,
        deEsserBypass: useDeEsser ? 0 : 1,
      }
    });

    const filter = offlineCtx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(essFreq, 0);

    const delay = offlineCtx.createDelay(1.0);
    delay.delayTime.setValueAtTime(0.005, 0);

    const sibilanceGainNode = offlineCtx.createGain();
    const makeupGainNode = offlineCtx.createGain();
    const dryGainNode = offlineCtx.createGain();
    const wetGainNode = offlineCtx.createGain();

    makeupGainNode.gain.setValueAtTime(makeupGain, 0);

    const crossoverLow = offlineCtx.createBiquadFilter();
    crossoverLow.type = 'lowpass';
    crossoverLow.frequency.setValueAtTime(4000, 0);
    crossoverLow.Q.setValueAtTime(0.5, 0);

    const crossoverHigh = offlineCtx.createBiquadFilter();
    crossoverHigh.type = 'highpass';
    crossoverHigh.frequency.setValueAtTime(4000, 0);
    crossoverHigh.Q.setValueAtTime(0.5, 0);

    offlineSource.connect(delay);
    delay.connect(workletNode, 0, 0);
    
    offlineSource.connect(filter);
    filter.connect(workletNode, 0, 1);

    const offlineMasterGain = offlineCtx.createGain();
    offlineMasterGain.gain.setValueAtTime(this.normalizationGain, 0);

    const offlineCompressor = offlineCtx.createDynamicsCompressor();
    offlineCompressor.threshold.setValueAtTime(compThresh, 0);
    offlineCompressor.ratio.setValueAtTime(useComp ? compRatio : 1, 0);
    offlineCompressor.knee.setValueAtTime(30, 0);
    offlineCompressor.attack.setValueAtTime(0.003, 0);
    offlineCompressor.release.setValueAtTime(0.25, 0);

    const offlineFinalMerge = offlineCtx.createGain();

    // Dry Routing
    delay.connect(dryGainNode); // Phase aligned with wet signal
    dryGainNode.connect(offlineFinalMerge); // Dry bypasses main processing

    // Wet Routing (Split Band)
    workletNode.connect(crossoverLow);
    workletNode.connect(crossoverHigh);

    // Low band untouched by manual ducking
    crossoverLow.connect(wetGainNode);
    
    // High band ducked by manual points
    crossoverHigh.connect(sibilanceGainNode);
    sibilanceGainNode.connect(wetGainNode);
    
    wetGainNode.connect(makeupGainNode);
    makeupGainNode.connect(offlineCompressor); // Wet path only

    // Offline EQ chain
    let offlineEqInput: AudioNode = offlineCompressor;
    eqParams.forEach(p => {
      const f = offlineCtx.createBiquadFilter();
      f.type = p.type;
      f.frequency.setValueAtTime(p.freq, 0);
      f.gain.setValueAtTime(p.gain, 0);
      f.Q.setValueAtTime(p.q, 0);
      offlineEqInput.connect(f);
      offlineEqInput = f;
    });

    // Offline Saturation (Exciter)
    const offSatCrossover = offlineCtx.createBiquadFilter();
    offSatCrossover.type = 'highpass';
    offSatCrossover.frequency.setValueAtTime(3000, 0);
    
    const offSat = offlineCtx.createWaveShaper();
    offSat.curve = this.makeSaturationCurve(saturation);
    
    const offSatGain = offlineCtx.createGain();
    offSatGain.gain.setValueAtTime(useExciter ? 0.5 : 0, 0);

    offlineCompressor.connect(offSatCrossover);
    offSatCrossover.connect(offSat);
    offSat.connect(offSatGain);

    // Final merge of processed wet and bypassed dry
    offlineEqInput.connect(offlineFinalMerge);
    offSatGain.connect(offlineFinalMerge);

    const offlineDC = offlineCtx.createBiquadFilter();
    offlineDC.type = 'highpass';
    offlineDC.frequency.setValueAtTime(20, 0);

    const offlineLimiter = offlineCtx.createDynamicsCompressor();
    offlineLimiter.threshold.setValueAtTime(-1.2, 0); // Strict Ceiling
    offlineLimiter.knee.setValueAtTime(0, 0);
    offlineLimiter.ratio.setValueAtTime(50, 0);
    offlineLimiter.attack.setValueAtTime(0, 0);
    offlineLimiter.release.setValueAtTime(0.1, 0);

    const offlineClipper = offlineCtx.createWaveShaper();
    offlineClipper.curve = this.clipper.curve;

    offlineFinalMerge.connect(offlineDC);
    offlineDC.connect(offlineLimiter);
    offlineLimiter.connect(offlineClipper);
    offlineClipper.connect(offlineCtx.destination);
    
    // Apply Equal-Power Crossfade Mix
    const mixVal = Math.max(0, Math.min(1, mix));
    dryGainNode.gain.setValueAtTime(Math.cos(mixVal * 0.5 * Math.PI), 0);
    wetGainNode.gain.setValueAtTime(Math.cos((1.0 - mixVal) * 0.5 * Math.PI), 0);

    sibilanceGainNode.gain.setValueAtTime(1.0, 0);
    
    if (useDeEsser) {
      const sortedPoints = [...this.sibilancePoints].sort((a, b) => a.time - b.time);
      let lastExportEndTime = 0;

      for (const pt of sortedPoints) {
        const scheduleTime = pt.time;
        const halfWidth = pt.width / 2;
        const startTime = scheduleTime - halfWidth;
        const endTime = scheduleTime + halfWidth;

        if (startTime < lastExportEndTime + 0.001) continue;
        
        try {
          sibilanceGainNode.gain.linearRampToValueAtTime(1.0, startTime);
          sibilanceGainNode.gain.linearRampToValueAtTime(pt.gain, scheduleTime);
          sibilanceGainNode.gain.linearRampToValueAtTime(1.0, endTime);
          lastExportEndTime = endTime;
        } catch (e) {
          console.warn("Skipping overlapping sibilance automation point in export", e);
        }
      }
    }

    offlineSource.start(0);

    onProgress(10); // Rendering graph initialized

    // Render AudioBuffer
    const renderedBuffer = await offlineCtx.startRendering();
    onProgress(50); // Graph rendered

    if (format === 'wav') {
      const wavBuffer = toWav(renderedBuffer);
      onProgress(100);
      return new Blob([wavBuffer], { type: 'audio/wav' });
    } else if (format === 'mp3') {
      const channels = renderedBuffer.numberOfChannels;
      const mp3encoder = new (lamejs as any).Mp3Encoder(channels, sampleRate, bitrate);
      const blocks: Int8Array[] = [];
      const sampleBlockSize = 1152 * 4; // Use larger chunks for faster encoding

      const left = renderedBuffer.getChannelData(0);
      const right = channels > 1 ? renderedBuffer.getChannelData(1) : left;

      // In-place memory optimization: Do not pre-allocate full Int16 arrays.
      // Convert Float32 to Int16 in small chunks during encoding to prevent OOM on mobile.
      const leftChunkInt16 = new Int16Array(sampleBlockSize * 10);
      const rightChunkInt16 = new Int16Array(sampleBlockSize * 10);

      return new Promise((resolve) => {
        let i = 0;
        const encodeChunk = () => {
          const end = Math.min(i + sampleBlockSize * 10, left.length);
          const chunkLen = end - i;

          // Convert current segment to Int16
          for (let j = 0; j < chunkLen; j++) {
            const idx = i + j;
            const lVal = left[idx];
            const rVal = right[idx];
            leftChunkInt16[j] = lVal < 0 ? lVal * 32768 : lVal * 32767;
            rightChunkInt16[j] = rVal < 0 ? rVal * 32768 : rVal * 32767;
          }

          for (let subI = 0; subI < chunkLen; subI += sampleBlockSize) {
            const nextSubI = Math.min(subI + sampleBlockSize, chunkLen);
            const lSub = leftChunkInt16.subarray(subI, nextSubI);
            const rSub = rightChunkInt16.subarray(subI, nextSubI);
            
            const mp3buf = channels === 2 ? mp3encoder.encodeBuffer(lSub, rSub) : mp3encoder.encodeBuffer(lSub);
            if (mp3buf.length > 0) blocks.push(mp3buf);
          }
          
          i = end;
          onProgress(mathRound(50 + (i / left.length) * 45)); // up to 95%
          
          if (i < left.length) {
            setTimeout(encodeChunk, 10); // 10ms gap to keep UI responsive
          } else {
            const mp3bufFinal = mp3encoder.flush();
            if (mp3bufFinal.length > 0) blocks.push(mp3bufFinal);
            onProgress(100);
            resolve(new Blob(blocks, { type: 'audio/mp3' }));
          }
        };
        
        encodeChunk();
      });
    }
    
    return new Blob();
  }

  /**
   * Cleans up all audio resources and closes the AudioContext.
   */
  async dispose() {
    this.isPlaying = false;
    this.pause();
    if (this.ctx) {
      await this.ctx.close();
    }
    this.audioBuffer = null;
    this.sourceNode = null;
    this.workletNode = null;
    this.sibilancePoints = [];
  }
}

function mathRound(n: number) {
  return Math.round(n);
}
