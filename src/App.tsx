/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo, memo } from 'react';
import WaveSurfer from 'wavesurfer.js';
import Spectrogram from 'wavesurfer.js/dist/plugins/spectrogram.esm.js';
import { Upload, Play, Pause, Download, Wand, Activity, Settings2, Sparkles, Info, ChevronRight, AlertCircle, Wand2, VolumeX, Volume2, RotateCcw, MousePointer2 } from 'lucide-react';
import { disableHmr } from './lib/utils';
import { AudioEngine } from './lib/audioEngine';

// Built-in Tooltip
const IconTooltip = ({ message, position = 'above', side = 'center' }: { message: string, position?: 'above' | 'below', side?: 'left' | 'right' | 'center' }) => (
  <div className="group relative inline-flex items-center justify-center ml-1 cursor-help">
    <div className="w-[14px] h-[14px] rounded-full border border-[#4a4f59] text-[#8E9299] group-hover:text-[#00F0FF] group-hover:border-[#00F0FF] flex items-center justify-center text-[10px] font-bold transition-colors">
      ?
    </div>
    <div className={`absolute ${position === 'above' ? 'bottom-full mb-2' : 'top-full mt-2'} ${side === 'center' ? 'left-1/2 -translate-x-1/2' : side === 'left' ? 'left-0' : 'right-0'} hidden group-hover:block w-[180px] p-2 text-[10px] leading-relaxed text-[#E0E2E5] bg-[#1E2229] border border-[#2D333D] rounded shadow-xl z-[100] pointer-events-none`}>
      {message}
      <div className={`absolute ${position === 'above' ? 'top-full border-t-[#1E2229]' : 'bottom-full border-b-[#1E2229]'} ${side === 'center' ? 'left-1/2 -translate-x-1/2' : side === 'left' ? 'left-4' : 'right-4'} border-4 border-transparent`}></div>
    </div>
  </div>
);

// Performance optimization: Memoize individual sibilance points
const SibilanceNode = memo(({ pt, audioDuration, wsWidth, onGainChange, onWidthChange }: { 
  pt: any, audioDuration: number, wsWidth: number, 
  onGainChange: (id: string, newGain: number) => void,
  onWidthChange: (id: string, newWidth: number) => void
}) => {
  const bellPath = useMemo(() => {
    const xPosPx = (pt.time / audioDuration) * wsWidth;
    const yPercent = (1.0 - (pt.gain / 1.5)) * 100;
    const radiusPx = (pt.width / audioDuration) * wsWidth / 2;
    const steps = 16;
    let pathPoints = [];
    for (let i = -steps; i <= steps; i++) {
      const t = i / steps;
      const dx = t * radiusPx;
      const bellFactor = Math.pow(Math.cos(t * Math.PI / 2), 2);
      const yVal = 0 + (yPercent - 0) * bellFactor;
      pathPoints.push(`${xPosPx + dx},${yVal}%`);
    }
    return `M ${xPosPx - radiusPx},0% L ${pathPoints.join(' L ')} L ${xPosPx + radiusPx},0%`;
  }, [pt.time, pt.gain, pt.width, audioDuration, wsWidth]);

  const xPosPx = (pt.time / audioDuration) * wsWidth;
  const yPercent = (1.0 - (pt.gain / 1.5)) * 100; 
  const radiusPx = (pt.width / audioDuration) * wsWidth / 2;

  const isInactive = pt.gain >= 0.995;

  return (
    <g className="pointer-events-auto" style={{ willChange: 'transform' }}>
      {/* Bell Curve Visualization */}
      {!isInactive && (
        <path 
          d={bellPath} 
          fill="url(#bellGradient)" 
          stroke="#00F0FF" 
          strokeWidth="1.5" 
          strokeOpacity="0.6" 
          fillOpacity="0.3" 
          className="pointer-events-none"
          style={{ shapeRendering: 'geometricPrecision' }}
        />
      )}
      
      <line x1={xPosPx} y1="0" x2={xPosPx} y2="100%" stroke={isInactive ? "rgba(74,79,89,0.2)" : "rgba(0,240,255,0.15)"} strokeWidth="1" strokeDasharray="4,4" className="pointer-events-none" />
      
      {/* Width Handle (Left) */}
      <circle 
        cx={xPosPx - radiusPx} 
        cy="0" 
        r="4" 
        fill="#00F0FF" 
        className="cursor-ew-resize hover:r-6 transition-all"
        onMouseDown={(e) => {
          e.preventDefault();
          const startX = e.clientX;
          const startWidth = pt.width;
          const onMouseMove = (m: MouseEvent) => {
            const deltaX = startX - m.clientX;
            const newWidth = Math.max(0.02, Math.min(2.0, startWidth + (deltaX / wsWidth) * audioDuration * 2));
            onWidthChange(pt.id, newWidth);
          };
          const onMouseUp = () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
          };
          window.addEventListener('mousemove', onMouseMove);
          window.addEventListener('mouseup', onMouseUp);
        }}
      />

      {/* Main Gain Node */}
      <g onMouseDown={(e) => {
        e.preventDefault();
        const startY = e.clientY;
        const startGain = pt.gain;
        const onMouseMove = (moveEvent: MouseEvent) => {
          const deltaY = moveEvent.clientY - startY;
          let newGain = startGain - (deltaY / 150);
          newGain = Math.max(0, Math.min(1.5, newGain));
          onGainChange(pt.id, newGain);
        };
        const onMouseUp = () => {
          window.removeEventListener('mousemove', onMouseMove);
          window.removeEventListener('mouseup', onMouseUp);
        };
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
      }}>
        <circle 
          cx={xPosPx} 
          cy={`${yPercent}%`} 
          r="7" 
          fill="#0A0B0E" 
          stroke="#00F0FF" 
          strokeWidth="2.5" 
          className="cursor-ns-resize hover:fill-[#00F0FF] transition-all filter drop-shadow-[0_0_8px_rgba(0,240,255,0.8)]"
        />
        <rect x={xPosPx - 20} y={`${yPercent - 18}%`} width="40" height="11" rx="2" fill="rgba(0,0,0,0.8)" className="pointer-events-none" />
        <text x={xPosPx} y={`${yPercent - 10}%`} fill="#00F0FF" fontSize="9" fontWeight="900" textAnchor="middle" className="pointer-events-none select-none font-mono tracking-tighter">
          L3 | {pt.gain.toFixed(2)}
        </text>
      </g>
    </g>
  );
});

// 256-level professional colormap for spectrogram (Black -> Purple -> Red -> Yellow -> White)
const generateColormap = () => {
  const map: number[][] = [];
  for (let i = 0; i < 256; i++) {
    const r = i / 255;
    if (r < 0.2) {
      // Black to Dark Purple (0-51)
      const v = r / 0.2;
      map.push([0.2 * v, 0, 0.4 * v, 1]);
    } else if (r < 0.4) {
      // Dark Purple to Bright Magenta (51-102)
      const v = (r - 0.2) / 0.2;
      map.push([0.2 + 0.8 * v, 0, 0.4 + 0.4 * v, 1]);
    } else if (r < 0.7) {
      // Magenta to Orange/Red (102-178)
      const v = (r - 0.4) / 0.3;
      map.push([1, 0.5 * v, 0.8 * (1 - v), 1]);
    } else if (r < 0.9) {
      // Red to Yellow (178-230)
      const v = (r - 0.7) / 0.2;
      map.push([1, 0.5 + 0.5 * v, 0, 1]);
    } else {
      // Yellow to White (230-255)
      const v = (r - 0.9) / 0.1;
      map.push([1, 1, v, 1]);
    }
  }
  return map;
};

export default function App() {
  const waveformRef = useRef<HTMLDivElement>(null);
  const spectrogramRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  
  const [audioEngine] = useState(() => new AudioEngine());
  const [isLoaded, setIsLoaded] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [originalFileName, setOriginalFileName] = useState('');
  const [currentLUFS, setCurrentLUFS] = useState<number | null>(null);
  const [isNormalizing, setIsNormalizing] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const currentOpIdRef = useRef<number>(0);
  
  const [sibilancePoints, setSibilancePoints] = useState<any[]>([]);
  const [rawSibilancePoints, setRawSibilancePoints] = useState<any[]>([]);
  const [pointSensitivity, setPointSensitivity] = useState(85); 
  const userGainsRef = useRef<Record<string, number>>({});
  
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showManual, setShowManual] = useState(false);
  
  const [audioDuration, setAudioDuration] = useState(0);
  
  // Real-time params
  const [gateThreshold, setGateThreshold] = useState(0.02);
  const [gateRatio, setGateRatio] = useState(4);
  const [essFreq, setEssFreq] = useState(5000);
  const [essLevel, setEssLevel] = useState(3);
  const [essThreshold, setEssThreshold] = useState(0.05);
  const [essAmount, setEssAmount] = useState(0.5);
  const [mix, setMix] = useState(1); // 0 = A(Dry), 1 = B(Wet)
  const [makeupGain, setMakeupGain] = useState(1.0);
  const [compThreshold, setCompThreshold] = useState(-24);
  const [compRatio, setCompRatio] = useState(4);
  const [saturation, setSaturation] = useState(0);
  const [eqParams, setEqParams] = useState([
    { freq: 60, gain: 0, q: 1, type: 'lowshelf' as BiquadFilterType },
    { freq: 500, gain: 0, q: 1, type: 'peaking' as BiquadFilterType },
    { freq: 2500, gain: 0, q: 1, type: 'peaking' as BiquadFilterType },
    { freq: 8000, gain: 0, q: 1, type: 'highshelf' as BiquadFilterType }
  ]);
  const [focusedEQNode, setFocusedEQNode] = useState<number | null>(null);
  const [plrValue, setPlrValue] = useState<number>(0);
  const [plrStatus, setPlrStatus] = useState<'Dynamic' | 'Commercial' | 'Crushed'>('Dynamic');

  // Export params
  const [exportFormat, setExportFormat] = useState<'wav'|'mp3'>('wav');
  const [exportBitrate, setExportBitrate] = useState(320);
  const [essReduction, setEssReduction] = useState(1.0);
  const [maxEssReduction, setMaxEssReduction] = useState(1.0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [targetLUFS, setTargetLUFS] = useState<-14 | -16>(-14);
  const [masterVolume, setMasterVolume] = useState(0.7);

  // Advanced Mode Bypasses (Expert control)
  const [useGate, setUseGate] = useState(true);
  const [useDeEsser, setUseDeEsser] = useState(true);
  const [useExciter, setUseExciter] = useState(true);
  const [useCompressor, setUseCompressor] = useState(true);

  const objectUrlRef = useRef<string | null>(null);
  const analyzerCanvasRef = useRef<HTMLCanvasElement>(null);
  const waveformContainerRef = useRef<HTMLDivElement>(null);
  const mixRef = useRef(mix);
  const [wsWidth, setWsWidth] = useState(0);

  useEffect(() => {
    audioEngine.setMasterVolume(masterVolume);
  }, [masterVolume, audioEngine]);

  useEffect(() => {
    audioEngine.onReduction = (total, esser) => {
      setEssReduction(esser);
    };
    
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isPlaying) {
        audioEngine.resumeContext();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      audioEngine.onReduction = null;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [audioEngine, isPlaying]);

  useEffect(() => {
    if (!wsRef.current || !isLoaded) return;
    
    // Use a more robust observation to track WaveSurfer's internal expansion
    const updateWidth = () => {
      const wrapper = wsRef.current?.getWrapper();
      if (wrapper) {
        setWsWidth(wrapper.scrollWidth);
      }
    };

    const observer = new ResizeObserver(() => {
      requestAnimationFrame(updateWidth);
    });
    
    const wrapper = wsRef.current.getWrapper();
    observer.observe(wrapper);
    
    return () => observer.disconnect();
  }, [isLoaded]); 

  useEffect(() => {
    // Track de-esser specific peak reduction for the "Red Text" feedback
    if (isPlaying && essReduction < 0.99) {
      if (essReduction < maxEssReduction) setMaxEssReduction(essReduction);
    }
  }, [essReduction, isPlaying]);

  useEffect(() => { mixRef.current = mix; }, [mix]);

  useEffect(() => {
    const canvas = analyzerCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const dataArrayDry = new Uint8Array(audioEngine.analyserDry.frequencyBinCount);
    const dataArrayWet = new Uint8Array(audioEngine.analyserWet.frequencyBinCount);
    let animationId: number;

    const draw = () => {
      animationId = requestAnimationFrame(draw);
      
      if (audioEngine.ctx.state !== 'running' || !isPlaying) {
         if (canvas.width > 0 && canvas.height > 0) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
         }
         return;
      }

      const parent = canvas.parentElement;
      if (parent) {
        if (canvas.width !== parent.clientWidth || canvas.height !== parent.clientHeight) {
          canvas.width = parent.clientWidth;
          canvas.height = parent.clientHeight;
        }
      }

      audioEngine.analyserDry.getByteFrequencyData(dataArrayDry);
      audioEngine.analyserWet.getByteFrequencyData(dataArrayWet);

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const width = canvas.width;
      const height = canvas.height;
      
      const dryPoints: [number, number][] = [];
      const wetPoints: [number, number][] = [];
      
      const minFreqRaw = 20;
      const maxFreqRaw = 20000;
      const sampleRate = audioEngine.ctx.sampleRate;
      const fftSize = audioEngine.analyserDry.fftSize;

      // LINEAR mapping for analysis curves
      for(let i = 0; i < dataArrayDry.length; i++) {
          const freq = i * (sampleRate / fftSize);
          if (freq < minFreqRaw) continue;
          if (freq > maxFreqRaw) break;
          
          const x = (freq / maxFreqRaw) * width;
          
          const vDry = dataArrayDry[i] / 255.0;
          const vWet = dataArrayWet[i] / 255.0;
          
          // Use high sensitivity for better visibility on black background
          const yDry = height - (Math.pow(vDry, 1.05) * height);
          const yWet = height - (Math.pow(vWet, 1.05) * height);
          
          dryPoints.push([x, yDry]);
          wetPoints.push([x, yWet]);
      }

      // Draw Dry (Red Curve)
      ctx.beginPath();
      ctx.moveTo(0, height);
      dryPoints.forEach(([x, y]) => ctx.lineTo(x, y));
      ctx.lineTo(width, height);
      ctx.fillStyle = 'rgba(255, 50, 50, 0.2)'; 
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 50, 50, 0.8)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Draw Wet (Blue Curve)
      ctx.beginPath();
      ctx.moveTo(0, height);
      wetPoints.forEach(([x, y]) => ctx.lineTo(x, y));
      ctx.lineTo(width, height);
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = 'rgba(0, 240, 255, 0.3)'; 
      ctx.fill();
      ctx.strokeStyle = 'rgba(0, 240, 255, 1)';
      ctx.lineWidth = 2;
      ctx.stroke();
      
      ctx.globalCompositeOperation = 'source-over';
    };

    draw();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [audioEngine, isPlaying]);

  const handleGainChange = (id: string, newGain: number) => {
    userGainsRef.current[id] = newGain;
    setSibilancePoints(prev => prev.map(p => p.id === id ? { ...p, gain: newGain } : p));
  };
  
  const handleWidthChange = (id: string, newWidth: number) => {
    setSibilancePoints(prev => prev.map(p => p.id === id ? { ...p, width: newWidth } : p));
  };
  useEffect(() => {
    disableHmr();
    audioEngine.init();
    
    return () => {
      wsRef.current?.destroy();
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, []);

  useEffect(() => { audioEngine.setGateBypass(!useGate); }, [useGate, audioEngine]);
  useEffect(() => { audioEngine.setDeEsserBypass(!useDeEsser); }, [useDeEsser, audioEngine]);
  useEffect(() => { audioEngine.setExciterBypass(!useExciter); }, [useExciter, audioEngine]);
  useEffect(() => { audioEngine.setCompBypass(!useCompressor); }, [useCompressor, audioEngine]);

  useEffect(() => { audioEngine.setGateThreshold(gateThreshold); }, [gateThreshold, audioEngine]);
  useEffect(() => { audioEngine.setGateRatio(gateRatio); }, [gateRatio, audioEngine]);
  useEffect(() => { audioEngine.setDeEsserFreq(essFreq); }, [essFreq, audioEngine]);
  useEffect(() => { audioEngine.setDeEsserThreshold(essThreshold); }, [essThreshold, audioEngine]);
  useEffect(() => { audioEngine.setDeEsserAmount(essAmount); }, [essAmount, audioEngine]);
  useEffect(() => { audioEngine.setMakeupGain(makeupGain); }, [makeupGain, audioEngine]);
  useEffect(() => { audioEngine.setCompThreshold(compThreshold); }, [compThreshold, audioEngine]);
  useEffect(() => { audioEngine.setCompRatio(compRatio); }, [compRatio, audioEngine]);
  useEffect(() => { audioEngine.setSaturation(saturation); }, [saturation, audioEngine]);
  
  useEffect(() => {
    eqParams.forEach((p, i) => {
      audioEngine.setEQParam(i, p.freq, p.gain, p.q);
    });
  }, [eqParams, audioEngine]);
  
  // 5-level automation mapping
  useEffect(() => {
    const levels = {
      1: { t: 0.15, a: 0.2 },
      2: { t: 0.08, a: 0.4 },
      3: { t: 0.04, a: 0.6 },
      4: { t: 0.02, a: 0.8 },
      5: { t: 0.005, a: 0.95 }
    };
    const target = levels[essLevel as keyof typeof levels] || levels[3];
    setEssThreshold(target.t);
    setEssAmount(target.a);
  }, [essLevel]);

  // Filter raw points by sensitivity
  useEffect(() => {
    if (!rawSibilancePoints.length) {
      setSibilancePoints([]);
      return;
    }
    const cutoff = 0.02 * Math.pow(1 - pointSensitivity / 100, 4); 
    const filtered = rawSibilancePoints.filter(pt => pt.peak >= cutoff).map(pt => {
      const defaultGain = Math.max(0.1, 1.0 - Math.min(0.9, Math.pow(pt.peak, 0.5) * 3));
      return {
        ...pt,
        gain: userGainsRef.current[pt.id] ?? defaultGain,
        width: pt.width ?? 0.15 // Default width 150ms
      };
    });
    setSibilancePoints(filtered);
    audioEngine.updateSibilancePoints(filtered);
  }, [rawSibilancePoints, pointSensitivity, audioEngine]);

  useEffect(() => { 
    audioEngine.updateSibilancePoints(sibilancePoints);
  }, [sibilancePoints, audioEngine]);

  useEffect(() => { 
    audioEngine.setMix(mix); 
    if (wsRef.current) {
      wsRef.current.setOptions({
        progressColor: mix === 0 ? '#00F0FF' : '#D4AF37',
        waveColor: mix === 0 ? '#2D333D' : 'rgba(212,175,55,0.4)',
        cursorColor: mix === 0 ? '#D4AF37' : '#00F0FF',
      });
    }
  }, [mix, audioEngine]);

  useEffect(() => {
    audioEngine.updateSibilancePoints(sibilancePoints);
  }, [sibilancePoints, audioEngine]);

  useEffect(() => {
    audioEngine.onReduction = (_val, essVal) => {
      setEssReduction(essVal);
    };
    return () => { audioEngine.onReduction = null; };
  }, [audioEngine]);

  const handleClear = () => {
    if (wsRef.current) {
      wsRef.current.destroy();
      wsRef.current = null;
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    audioEngine.clear();
    
    setIsLoaded(false);
    setIsPlaying(false);
    setRawSibilancePoints([]);
    setSibilancePoints([]);
    userGainsRef.current = {};
    setPointSensitivity(85);
    setAudioDuration(0);
    setIsAnalyzing(false);
    setMaxEssReduction(1.0);
    setWsWidth(0);
    setCurrentLUFS(null);
    setTargetLUFS(-14);
    setMakeupGain(1.0);
    setGateThreshold(0.02);
    setGateRatio(4);
    setEssLevel(3);
    setEssFreq(5000);
    setMix(1);
    setCompThreshold(-24);
    setCompRatio(4);
    setSaturation(0);
    setEqParams([
      { freq: 60, gain: 0, q: 1, type: 'lowshelf' as BiquadFilterType },
      { freq: 500, gain: 0, q: 1, type: 'peaking' as BiquadFilterType },
      { freq: 2500, gain: 0, q: 1, type: 'peaking' as BiquadFilterType },
      { freq: 8000, gain: 0, q: 1, type: 'highshelf' as BiquadFilterType }
    ]);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (isAnalyzing) return; // Prevention of race condition upload
    const file = event.target.files?.[0];
    if (!file) return;

    // RAM usage guard: 150MB limit to prevent OOM on mobile
    if (file.size > 150 * 1024 * 1024) {
      alert("파일 용량이 너무 큽니다 (최대 150MB). 브라우저 메모리 부족으로 인한 오류 방지를 위해 제한됩니다.");
      return;
    }

    handleClear();
    setIsAnalyzing(true);
    const opId = ++currentOpIdRef.current;
    setOriginalFileName(file.name.replace(/\.[^/.]+$/, ""));

    const objectUrl = URL.createObjectURL(file);
    objectUrlRef.current = objectUrl;

    wsRef.current = WaveSurfer.create({
      container: waveformRef.current!,
      waveColor: '#2D333D',
      progressColor: '#00F0FF',
      height: 200,
      barWidth: 2,
      cursorColor: '#D4AF37',
      normalize: true,
      fillParent: true,
      minPxPerSec: 0,
      interact: true, 
      plugins: []
    });

    wsRef.current.setVolume(0);
    wsRef.current.load(objectUrl);
    
    try {
      const buffer = await audioEngine.loadAudio(file);
      
      // Abandon results if a newer operation has started
      if (opId !== currentOpIdRef.current) return;

      setIsLoaded(true);
      setRawSibilancePoints(audioEngine.sibilancePoints);
      userGainsRef.current = {};
      setPointSensitivity(85);
      setAudioDuration(buffer.duration);
      
      // Initial LUFS analysis for dashboard
      const lufs = await audioEngine.calculateLUFS(buffer);
      if (opId !== currentOpIdRef.current) return;
      
      if (lufs < -90) {
        alert("입력 신호가 너무 작거나 무음입니다. 분석이 취소됩니다.");
        handleClear();
        return;
      }
      setCurrentLUFS(lufs);
    } catch (e) {
      if (opId === currentOpIdRef.current) {
        console.error(e);
        alert("오디오 로딩 또는 분석 중 오류가 발생했습니다.");
      }
    } finally {
      if (opId === currentOpIdRef.current) {
        setIsAnalyzing(false);
      }
    }
  };

  useEffect(() => {
    if (!wsRef.current || !isLoaded) return;
    
    const ws = wsRef.current;
    
    const onPlay = () => {
       setIsPlaying(true);
       audioEngine.seek(ws.getCurrentTime());
       audioEngine.play();
    };
    const onPause = () => {
       setIsPlaying(false);
       audioEngine.pause();
    };
    const onInteraction = (newTime: number) => {
       // If scrubbing (dragging), don't trigger per-frame seek to prevent audio stuttering.
       // The actual seek will happen in onPointerUp.
       if (!isScrubbing) {
         audioEngine.seek(newTime);
       }
    };
    const onFinish = () => {
       setIsPlaying(false);
       audioEngine.pause();
       audioEngine.seek(0);
    };

    ws.on('play', onPlay);
    ws.on('pause', onPause);
    ws.on('interaction', onInteraction);
    ws.on('finish', onFinish);

    return () => {
      ws.un('play', onPlay);
      ws.un('pause', onPause);
      ws.un('interaction', onInteraction);
      ws.un('finish', onFinish);
    };
  }, [isLoaded, audioEngine]);

  useEffect(() => {
    // Handle spectrogram clicks for Spectral Picking
    const spectrogramContainer = spectrogramRef.current;
    if (!spectrogramContainer || !isLoaded) return;

    const handleSpecClick = (e: MouseEvent) => {
      // Prevent picking if we clicked a node
      if ((e.target as HTMLElement).closest('circle')) return;
      
      const rect = spectrogramContainer.getBoundingClientRect();
      
      // Calculate frequency based on X position for horizontal layout
      const x = e.clientX - rect.left;
      const w = rect.width;
      const minF = 20;
      const maxF = 20000;
      const freq = Math.pow(10, Math.log10(minF) + (x/w) * (Math.log10(maxF) - Math.log10(minF)));
      
      setEqParams(prev => {
        let nearestIdx = 0;
        let minDist = Infinity;
        prev.forEach((p, i) => {
          const d = Math.abs(Math.log10(p.freq) - Math.log10(freq));
          if (d < minDist) {
            minDist = d;
            nearestIdx = i;
          }
        });
        const next = [...prev];
        next[nearestIdx].freq = Math.round(freq);
        setFocusedEQNode(nearestIdx);
        return next;
      });
    };
    
    spectrogramContainer.addEventListener('mousedown', handleSpecClick);
    return () => spectrogramContainer.removeEventListener('mousedown', handleSpecClick);
  }, [isLoaded]);

  // PLR Monitoring Loop with Smoothing
  useEffect(() => {
    let animFrame: number;
    let lastUpdateAt = 0;
    let smoothedPlr = 0;

    const update = (now: number) => {
      if (isPlaying && isLoaded) {
        const { peak, rms } = audioEngine.getRealtimeLevels();
        if (peak > 0 && rms > 0) {
          const peakDB = 20 * Math.log10(peak);
          const rmsDB = 20 * Math.log10(Math.max(0.00001, rms));
          const currentPlr = peakDB - rmsDB;
          
          // Apply smoothing: faster attack, slower decay for better visual character
          if (currentPlr > smoothedPlr) {
            smoothedPlr = smoothedPlr * 0.7 + currentPlr * 0.3;
          } else {
            smoothedPlr = smoothedPlr * 0.95 + currentPlr * 0.05;
          }

          // Throttle UI updates to ~15fps (every 66ms) to prevent excessive React renders
          if (now - lastUpdateAt > 66) {
            setPlrValue(smoothedPlr);
            
            if (smoothedPlr > 12) setPlrStatus('Dynamic');
            else if (smoothedPlr >= 8) setPlrStatus('Commercial');
            else setPlrStatus('Crushed');
            
            lastUpdateAt = now;
          }
        }
      } else if (!isPlaying) {
        setPlrValue(0);
        smoothedPlr = 0;
      }
      animFrame = requestAnimationFrame(update);
    };
    animFrame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(animFrame);
  }, [isPlaying, isLoaded, audioEngine]);

  useEffect(() => {
    if (!wsRef.current) return;
    wsRef.current.on('finish', () => {
       setIsPlaying(false);
       audioEngine.pause();
       audioEngine.seek(0);
    });
  }, [isLoaded]);

  const togglePlayback = async () => {
    if (!wsRef.current) return;
    await audioEngine.resumeContext();
    wsRef.current.playPause();
  };

  const handleSmartOptimize = async () => {
    if (!isLoaded || isOptimizing) return;
    setIsOptimizing(true);
    try {
      await audioEngine.resumeContext();
      const result = await audioEngine.smartOptimize(targetLUFS);
      
      setCurrentLUFS(result.lufs);
      // Update state, which will automatically trigger the AudioEngine updates via useEffect
      setMakeupGain(result.gain);
      setCompThreshold(result.compThreshold);
      setCompRatio(result.compRatio);
      setSaturation(result.saturation);
      
      setEqParams(prev => {
        const next = [...prev];
        result.eq.forEach(rec => {
          if (next[rec.index]) {
            next[rec.index] = { ...next[rec.index], freq: rec.freq, gain: rec.gain, q: rec.q };
          }
        });
        return next;
      });

      setMix(1); // Ensure we're hearing the processed version
      
      // Auto-reanalyze sibilance for the new optimized gain context
      if (audioEngine.audioBuffer) {
        const newPoints = await audioEngine.analyzeSibilance(audioEngine.audioBuffer);
        setRawSibilancePoints(newPoints);
      }
    } catch (e) {
      console.error("Optimization failed", e);
    } finally {
      setIsOptimizing(false);
    }
  };

  // Trigger width update
  useEffect(() => {
    if (wsRef.current && isLoaded) {
      const update = () => {
        const wrapper = wsRef.current?.getWrapper();
        if (wrapper) setWsWidth(wrapper.scrollWidth);
      };
      
      wsRef.current.on('redraw', update);
      wsRef.current.on('zoom', update);
      
      return () => {
        wsRef.current?.un('redraw', update);
        wsRef.current?.un('zoom', update);
      };
    }
  }, [isLoaded]);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in input (though we don't have text inputs right now)
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.code === 'Space') {
        e.preventDefault();
        togglePlayback();
      } else if (e.key.toLowerCase() === 'a' || e.key === '1') {
        setMix(0);
      } else if (e.key.toLowerCase() === 'b' || e.key === '2') {
        setMix(1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isLoaded]);

  const handleNormalize = async (target: number) => {
    if (!isLoaded || isNormalizing) return;
    setIsNormalizing(true);
    try {
      const lufs = await audioEngine.applyNormalization(target);
      setCurrentLUFS(lufs);
      setTargetLUFS(target);
    } catch (e) {
      console.error(e);
      alert("LUFS 정규화 작업 중 오류가 발생했습니다.");
    } finally {
      setIsNormalizing(false);
    }
  };

  const handleExport = async () => {
    if (!isLoaded || isExporting) return;
    setIsExporting(true);
    setExportProgress(0);
    try {
      // Must pass points into engine just in case
      audioEngine.updateSibilancePoints(sibilancePoints);
                      const blob = await audioEngine.exportOffline(
                        gateThreshold,
                        gateRatio,
                        essThreshold,
                        essAmount,
                        essFreq,
                        makeupGain,
                        compThreshold,
                        compRatio,
                        saturation,
                        eqParams,
                        mix,
                        exportFormat,
                        exportBitrate,
                        (p) => setExportProgress(p),
                        useGate,
                        useDeEsser,
                        useExciter,
                        useCompressor
                      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const fileName = originalFileName || 'SunoMaster';
      a.download = `${fileName}_deessed.${exportFormat}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      console.error(e);
      alert("내보내기 중 오류가 발생했습니다.");
    } finally {
      setIsExporting(false);
      setExportProgress(0);
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#0A0B0E] text-[#E0E2E5] font-sans flex flex-col">
      {/* Header */}
      <header className="h-[64px] min-h-[64px] bg-[#0A0B0E] border-b border-[#2D333D] px-6 flex items-center justify-between z-50">
        <div className="flex items-center gap-4">
          <div className="w-9 h-9 bg-gradient-to-br from-[#00F0FF] to-[#0066FF] rounded-lg flex items-center justify-center shadow-[0_0_20px_rgba(0,240,255,0.3)]">
            <Sparkles className="w-5 h-5 text-black" />
          </div>
          <div className="flex flex-col">
            <h1 className="text-[17px] font-black tracking-tighter text-[#E0E2E5] leading-none uppercase">RE-MASTER <span className="text-[#00F0FF]">AI</span> PREP PRO <span className="text-[12px] font-bold text-[#8E9299] ml-1">(원석가공기 for 마스터링)</span></h1>
            <div className="flex items-center mt-1.5">
              <span className="text-[#8E9299] font-black text-[9px] uppercase tracking-[2px]">Source Prep Engine v2.0</span>
              <span className="w-1 h-1 bg-[#4a4f59] rounded-full mx-2"></span>
              <span className="text-[#4a4f59] text-[9px] font-bold tracking-tight uppercase">Mastering Readiness Build</span>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-6">
          <div className="hidden lg:flex items-center gap-4 border-l border-[#2D333D] pl-6">
             <div className="flex flex-col items-end">
              <span className="text-[9px] text-[#4a4f59] font-black uppercase tracking-widest">Engine Mode</span>
              <span className="text-[10px] text-[#00F0FF] font-mono leading-none">OFFLINE READY</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button 
              onClick={() => setShowManual(true)}
              className="bg-[#FFFF00] hover:bg-white text-black px-6 py-2.5 rounded text-[11px] font-black tracking-tight transition-all flex items-center shadow-[0_4px_15px_rgba(255,255,0,0.3)] uppercase group"
            >
              <Info className="w-4 h-4 mr-2 group-hover:scale-110 transition-transform" />
              사용법
            </button>
            {isLoaded && (
               <button onClick={handleClear} className="text-[#8E9299] hover:text-white bg-[#16181D] border border-[#2D333D] px-4 py-2 rounded text-[10px] font-black transition-all hover:bg-[#2D333D]">
                  RESET
               </button>
            )}
            <label className="cursor-pointer bg-[#00F0FF] hover:bg-white text-black px-6 py-2.5 rounded text-[11px] font-black tracking-tight transition-all flex items-center shadow-[0_4px_15px_rgba(0,240,255,0.2)]">
              <Upload className="w-4 h-4 mr-2" />
              {isLoaded ? "OPEN NEW" : "IMPORT AUDIO"}
              <input type="file" className="hidden" accept="audio/*" onChange={handleFileUpload} onClick={(e) => { e.currentTarget.value = ''; }} />
            </label>
          </div>
        </div>
      </header>

      {/* Main Content Grid */}
      <main className="flex-1 bg-[#2D333D] flex flex-col md:grid md:grid-cols-[280px_1fr] gap-[1px]">
        
        {/* Left Column (Aside) */}
        <aside className="bg-[#0A0B0E] flex flex-col md:overflow-y-auto border-r border-[#2D333D] w-full custom-scrollbar relative z-20">
          <div className="h-[36px] min-h-[36px] px-4 flex items-center bg-[#16181D] border-b border-[#2D333D] justify-between">
            <div className="text-[10px] font-black uppercase tracking-[2px] text-[#4a4f59]">
              TRACK DASHBOARD
            </div>
            <div className="flex items-center gap-1">
              <button 
                onClick={() => setShowAdvanced(!showAdvanced)}
                className={`p-1.5 rounded transition-colors ${showAdvanced ? 'text-[#A5FF00] bg-[rgba(165,255,0,0.1)]' : 'text-[#4a4f59] hover:text-[#A5FF00]'}`}
                title="Advanced Settings"
              >
                <Settings2 className="w-4 h-4" />
              </button>
            </div>
          </div>
          
          <div className="p-4 space-y-4">
            {/* Simple Mode: Summary Cards */}
            {!showAdvanced ? (
              <div className="space-y-4">
                {/* File Info Card */}
                <div className="bg-[#111317] rounded-xl border border-[#2D333D] p-4 shadow-xl relative overflow-hidden group">
                  <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity">
                    <Activity className="w-12 h-12 text-[#00F0FF]" />
                  </div>
                  <div className="text-[9px] font-black text-[#4a4f59] uppercase tracking-widest mb-3 flex items-center gap-2">
                    <div className="w-1 h-1 rounded-full bg-[#00F0FF]"></div>
                    Source Properties
                  </div>
                  <div className="space-y-3">
                    <div className="flex flex-col">
                      <span className="text-[10px] text-[#8E9299] font-medium mb-0.5">Filename</span>
                      <span className="text-[12px] font-bold text-[#E0E2E5] truncate" title={originalFileName}>
                        {originalFileName || 'No file loaded'}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-4 pt-2 border-t border-[#2D333D]">
                      <div>
                        <span className="text-[9px] text-[#4a4f59] font-black uppercase tracking-widest block mb-1">Duration</span>
                        <span className="text-[11px] font-mono text-[#E0E2E5]">
                          {audioDuration ? `${Math.floor(audioDuration / 60)}:${Math.floor(audioDuration % 60).toString().padStart(2, '0')}` : '--:--'}
                        </span>
                      </div>
                      <div>
                        <span className="text-[9px] text-[#4a4f59] font-black uppercase tracking-widest block mb-1">Engine</span>
                        <span className="text-[11px] font-mono text-[#00F0FF]">44.1kHz / 32-bit</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Mastering Summary Card */}
                <div className="bg-[#111317] rounded-xl border border-[#2D333D] p-4 shadow-xl">
                   <div className="text-[9px] font-black text-[#4a4f59] uppercase tracking-widest mb-3 flex items-center gap-2">
                    <div className="w-1 h-1 rounded-full bg-[#D4AF37]"></div>
                    Loudness & Dynamics
                  </div>
                  <div className="space-y-4">
                    <div className="bg-[#0A0B0E] rounded-lg p-3 border border-[#2D333D] flex items-center justify-between">
                       <span className="text-[10px] text-[#8E9299] font-bold uppercase tracking-tighter">Current LUFS</span>
                       <span className={`text-[12px] font-mono font-black ${currentLUFS ? 'text-[#D4AF37]' : 'text-[#4a4f59]'}`}>
                         {currentLUFS ? `${currentLUFS.toFixed(1)} LUFS` : 'NOT ANALYZED'}
                       </span>
                    </div>
                    
                    <div className="bg-[#0A0B0E] rounded-lg p-3 border border-[#2D333D]">
                       <div className="flex justify-between items-center mb-2">
                         <span className="text-[10px] text-[#8E9299] font-bold uppercase tracking-tighter">Dynamics (PLR)</span>
                         <span className={`text-[11px] font-mono font-black ${plrStatus === 'Commercial' ? 'text-[#00F0FF]' : plrStatus === 'Crushed' ? 'text-red-500' : 'text-[#D4AF37]'}`}>
                           {plrValue.toFixed(1)} dB
                         </span>
                       </div>
                       <div className="h-1 w-full bg-[#16181D] rounded-full overflow-hidden">
                          <div 
                            className={`h-full transition-all duration-300 ${plrStatus === 'Commercial' ? 'bg-[#00F0FF]' : plrStatus === 'Crushed' ? 'bg-red-500' : 'bg-[#D4AF37]'}`} 
                            style={{ width: `${Math.min(100, (plrValue / 20) * 100)}%` }}
                          />
                       </div>
                    </div>
                  </div>
                </div>

                {/* Processor Status Card */}
                <div className="bg-[#111317] rounded-xl border border-[#2D333D] p-4 shadow-xl">
                   <div className="text-[9px] font-black text-[#4a4f59] uppercase tracking-widest mb-3 flex items-center gap-2">
                    <div className="w-1 h-1 rounded-full bg-[#00F0FF]"></div>
                    Processor Status
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-[#0A0B0E] rounded p-2 border border-[#2D333D]">
                      <span className="text-[8px] text-[#4a4f59] block mb-1 uppercase font-black">De-Esser</span>
                      <span className="text-[10px] text-[#E0E2E5] font-mono">{sibilancePoints.length} Nodes</span>
                    </div>
                    <div className="bg-[#0A0B0E] rounded p-2 border border-[#2D333D]">
                      <span className="text-[8px] text-[#4a4f59] block mb-1 uppercase font-black">Gate</span>
                      <span className="text-[10px] text-[#00F0FF] font-mono">{gateThreshold > 0.001 ? 'Active' : 'Off'}</span>
                    </div>
                    <div className="bg-[#0A0B0E] rounded p-2 border border-[#2D333D]">
                      <span className="text-[8px] text-[#4a4f59] block mb-1 uppercase font-black">Exciter</span>
                      <span className="text-[10px] text-[#E0E2E5] font-mono">{Math.round(saturation * 100)}%</span>
                    </div>
                    <div className="bg-[#0A0B0E] rounded p-2 border border-[#2D333D]">
                      <span className="text-[8px] text-[#4a4f59] block mb-1 uppercase font-black">Comp</span>
                      <span className="text-[10px] text-[#D4AF37] font-mono">{compThreshold}dB</span>
                    </div>
                  </div>
                </div>

                {/* Quick Action Hints */}
                <div className="p-3 bg-[rgba(0,240,255,0.02)] border border-[rgba(0,240,255,0.1)] rounded-lg border-dashed">
                  <div className="flex items-center gap-2 mb-2">
                    <Wand className="w-3 h-3 text-[#00F0FF]" />
                    <span className="text-[10px] font-black text-[#00F0FF] uppercase tracking-wider">Smart Assistant</span>
                  </div>
                  <p className="text-[10px] text-[#8E9299] leading-relaxed">
                    오른쪽 패널의 <span className="text-[#D4AF37] font-bold">PRE-MASTER PREP</span> 버튼을 누르면 AI가 오디오를 분석하여 즉시 최적의 마스터링 대비 준비 상태로 만들어줍니다.
                  </p>
                </div>
              </div>
            ) : (
              /* Advanced Mode: Original Cards */
              <div className="space-y-4">
                {/* Auto Gate Card */}
                <div className="bg-[#16181D] rounded-lg border border-[#2D333D] p-3.5 shadow-inner">
                  <div className="flex items-center justify-between mb-5">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded bg-[rgba(0,240,255,0.1)] flex items-center justify-center border border-[rgba(0,240,255,0.2)]">
                        <Activity className="w-3 h-3 text-[#00F0FF]" />
                      </div>
                      <span className="text-[11px] font-black text-[#E0E2E5] uppercase tracking-tighter">자동 잔향 억제</span>
                      <IconTooltip message="모든 소리가 끝나는 지점의 꼬리를 짤라내어 공간의 잔향을 지웁니다." side="right" />
                    </div>
                    <button 
                      onClick={() => setUseGate(!useGate)}
                      className={`text-[9px] px-2 py-0.5 rounded font-black transition-all ${useGate ? 'bg-[#00F0FF] text-black shadow-[0_0_8px_#00F0FF]' : 'bg-[#16181D] text-[#4a4f59] border border-[#2D333D]'}`}
                    >
                      {useGate ? 'ON' : 'BYPASS'}
                    </button>
                  </div>
                  <div className="space-y-5">
                    <div>
                      <label className="flex justify-between text-[10px] text-[#8E9299] mb-3 font-mono uppercase tracking-[1px]">
                        <span>Gate Threshold</span>
                        <span className="text-[#00F0FF] font-bold">{gateThreshold.toFixed(3)}</span>
                      </label>
                      <div className="relative h-1 bg-[#0A0B0E] rounded-full flex items-center">
                        <input type="range" min="0" max="0.1" step="0.001" value={gateThreshold} onChange={e => setGateThreshold(parseFloat(e.target.value))} aria-label="Gate Threshold" className="w-full absolute inset-0 opacity-0 cursor-pointer z-10" />
                        <div className="h-full bg-gradient-to-r from-[#2D333D] to-[#00F0FF] rounded-full" style={{ width: `${(gateThreshold / 0.1) * 100}%` }}></div>
                      </div>
                    </div>
                    <div>
                      <label className="flex justify-between text-[10px] text-[#8E9299] mb-3 font-mono uppercase tracking-[1px]">
                        <span>Reduction Ratio</span>
                        <span className="text-[#00F0FF] font-bold">{gateRatio.toFixed(1)}:1</span>
                      </label>
                      <div className="relative h-1 bg-[#0A0B0E] rounded-full flex items-center">
                        <input type="range" min="1" max="20" step="0.1" value={gateRatio} onChange={e => setGateRatio(parseFloat(e.target.value))} aria-label="Gate Ratio" className="w-full absolute inset-0 opacity-0 cursor-pointer z-10" />
                        <div className="h-full bg-gradient-to-r from-[#2D333D] to-[#00F0FF] rounded-full" style={{ width: `${((gateRatio - 1) / 19) * 100}%` }}></div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Auto De-Esser Card */}
                <div className="bg-[#16181D] rounded-lg border border-[#2D333D] p-3.5 shadow-inner">
                  <div className="flex items-center justify-between mb-5">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded bg-[rgba(0,240,255,0.1)] flex items-center justify-center border border-[rgba(0,240,255,0.2)]">
                        <Activity className="w-3 h-3 text-[#00F0FF]" />
                      </div>
                      <span className="text-[11px] font-black text-[#E0E2E5] uppercase tracking-tighter">자동 치찰음 억제</span>
                      <IconTooltip message="재생되는 내내 고음역대를 감지하여 자동으로 치찰음을 통제합니다." side="right" />
                    </div>
                    <button 
                      onClick={() => setUseDeEsser(!useDeEsser)}
                      className={`text-[9px] px-2 py-0.5 rounded font-black transition-all ${useDeEsser ? 'bg-[#00F0FF] text-black shadow-[0_0_8px_#00F0FF]' : 'bg-[#16181D] text-[#4a4f59] border border-[#2D333D]'}`}
                    >
                      {useDeEsser ? 'ON' : 'BYPASS'}
                    </button>
                  </div>
                  <div className="space-y-5">
                    <div>
                      <label className="flex justify-between text-[10px] text-[#8E9299] mb-3 font-mono uppercase tracking-[1px]">
                        <span>Target Frequency</span>
                        <span className="text-[#00F0FF] font-bold">{essFreq} Hz</span>
                      </label>
                      <div className="relative h-1 bg-[#0A0B0E] rounded-full flex items-center">
                        <input type="range" min="2000" max="10000" step="100" value={essFreq} onChange={e => setEssFreq(parseFloat(e.target.value))} aria-label="De-esser Frequency" className="w-full absolute inset-0 opacity-0 cursor-pointer z-10" />
                        <div className="h-full bg-gradient-to-r from-[#2D333D] to-[#00F0FF] rounded-full" style={{ width: `${((essFreq - 2000) / 8000) * 100}%` }}></div>
                      </div>
                    </div>
                    <div>
                      <label className="flex justify-between text-[10px] text-[#8E9299] mb-3 font-mono uppercase tracking-[1px]">
                        <span>Strength Level</span>
                        <span className="text-[#00F0FF] font-bold">LV {essLevel}</span>
                      </label>
                      <div className="grid grid-cols-5 gap-1.5">
                        {[1,2,3,4,5].map(lvl => {
                          const messages = [
                            "약함 (Soft): 가벼운 치찰음 제거",
                            "가벼움 (Light): 표준적인 치찰음 제거",
                            "보통 (Normal): 균형 잡힌 제거 스타일 (추천)",
                            "강함 (Strong): 확실한 치찰음 억제",
                            "매우 강함 (Aggressive): 강력한 억제 (음질 저하 주의)"
                          ];
                          return (
                            <div key={lvl} className="group/btn relative">
                              <button onClick={() => setEssLevel(lvl)} 
                                className={`w-full py-2 rounded text-[10px] font-black border transition-all ${essLevel === lvl ? 'bg-[#00F0FF] border-[#00F0FF] text-black shadow-[0_0_10px_rgba(0,240,255,0.4)]' : 'bg-[#0A0B0E] border-[#2D333D] text-[#4a4f59] hover:border-[#8E9299]'}`}
                              >
                                {lvl}
                              </button>
                              <div className={`absolute bottom-full mb-2 hidden group-hover/btn:block w-[140px] p-2 text-[9px] leading-tight text-[#E0E2E5] bg-[#1E2229] border border-[#2D333D] rounded shadow-xl z-50 pointer-events-none text-center ${lvl === 1 ? 'left-0' : lvl === 5 ? 'right-0' : 'left-1/2 -translate-x-1/2'}`}>
                                {messages[lvl-1]}
                                <div className={`absolute top-full border-4 border-transparent border-t-[#1E2229] ${lvl === 1 ? 'left-4' : lvl === 5 ? 'right-4' : 'left-1/2 -translate-x-1/2'}`}></div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Mastering EQ & Exciter Card */}
                <div className="bg-[#16181D] rounded-lg border border-[#00F0FF] border-opacity-30 p-3.5 shadow-inner">
                  <div className="flex items-center justify-between mb-5">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded bg-[rgba(0,240,255,0.1)] flex items-center justify-center border border-[rgba(0,240,255,0.2)]">
                        <Sparkles className="w-3 h-3 text-[#00F0FF]" />
                      </div>
                      <span className="text-[11px] font-black text-[#E0E2E5] uppercase tracking-tighter">Harmonic Exciter (배음 생성)</span>
                      <IconTooltip message="원본에 없는 고주파 배음을 인위적으로 생성하여 '쨍한' 느낌을 줍니다. 비어있는 4k+ 대역을 채우는 데 효과적입니다." side="right" />
                    </div>
                    <button 
                      onClick={() => setUseExciter(!useExciter)}
                      className={`text-[9px] px-2 py-0.5 rounded font-black transition-all ${useExciter ? 'bg-[#00F0FF] text-black shadow-[0_0_8px_#00F0FF]' : 'bg-[#16181D] text-[#4a4f59] border border-[#2D333D]'}`}
                    >
                      {useExciter ? 'ON' : 'BYPASS'}
                    </button>
                  </div>
                  <div className="space-y-5">
                    <div>
                      <label className="flex justify-between text-[10px] text-[#8E9299] mb-3 font-mono uppercase tracking-[1px]">
                        <span>Saturator Amount</span>
                        <span className="text-[#00F0FF] font-bold">{(saturation * 100).toFixed(0)}%</span>
                      </label>
                      <div className="relative h-1 bg-[#0A0B0E] rounded-full flex items-center">
                        <input type="range" min="0" max="1" step="0.01" value={saturation} onChange={e => setSaturation(parseFloat(e.target.value))} aria-label="Saturation Amount" className="w-full absolute inset-0 opacity-0 cursor-pointer z-10" />
                        <div className="h-full bg-gradient-to-r from-[#2D333D] to-[#00F0FF] rounded-full" style={{ width: `${saturation * 100}%` }}></div>
                      </div>
                    </div>
                    
                    <div className="pt-2 border-t border-[#2D333D]">
                       <span className="text-[9px] font-black text-[#4a4f59] uppercase tracking-widest mb-2 block">Quick EQ Points</span>
                       <div className="grid grid-cols-2 gap-2">
                          {eqParams.map((p, i) => (
                            <div key={i} className={`p-2 rounded border transition-all cursor-pointer ${focusedEQNode === i ? 'bg-[rgba(0,240,255,0.1)] border-[#00F0FF]' : 'bg-[#0A0B0E] border-[#2D333D]'}`} onClick={() => setFocusedEQNode(i)}>
                               <div className="flex justify-between items-center mb-1">
                                  <span className="text-[8px] font-black text-[#E0E2E5]">L{i+1}</span>
                                  <span className="text-[9px] text-[#00F0FF] font-mono">{p.gain.toFixed(1)}dB</span>
                               </div>
                               <div className="text-[10px] text-[#8E9299] font-mono">{Math.round(p.freq)}Hz</div>
                            </div>
                          ))}
                       </div>
                    </div>
                  </div>
                </div>

                {/* Dynamic Range Control Card */}
                <div className="bg-[#16181D] rounded-lg border border-[#D4AF37] border-opacity-30 p-3.5 shadow-inner">
                  <div className="flex items-center justify-between mb-5">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded bg-[rgba(212,175,55,0.1)] flex items-center justify-center border border-[rgba(212,175,55,0.2)]">
                        <Activity className="w-3 h-3 text-[#D4AF37]" />
                      </div>
                      <span className="text-[11px] font-black text-[#E0E2E5] uppercase tracking-tighter">다이내믹 레인지 조절</span>
                      <IconTooltip message="컴프레서를 사용하여 소리의 크기 편차를 줄이고, 전체적으로 단단하고 묵직한 소리를 만듭니다." side="right" />
                    </div>
                    <button 
                      onClick={() => setUseCompressor(!useCompressor)}
                      className={`text-[9px] px-2 py-0.5 rounded font-black transition-all ${useCompressor ? 'bg-[#D4AF37] text-black shadow-[0_0_8px_#D4AF37]' : 'bg-[#16181D] text-[#4a4f59] border border-[#2D333D]'}`}
                    >
                      {useCompressor ? 'ON' : 'BYPASS'}
                    </button>
                  </div>
                  <div className="space-y-5">
                    <div>
                      <label className="flex justify-between text-[10px] text-[#8E9299] mb-3 font-mono uppercase tracking-[1px]">
                        <span>Comp Threshold</span>
                        <span className="text-[#D4AF37] font-bold">{compThreshold} dB</span>
                      </label>
                      <div className="relative h-1 bg-[#0A0B0E] rounded-full flex items-center">
                        <input type="range" min="-60" max="0" step="1" value={compThreshold} onChange={e => setCompThreshold(parseFloat(e.target.value))} aria-label="Compressor Threshold" className="w-full absolute inset-0 opacity-0 cursor-pointer z-10" />
                        <div className="h-full bg-gradient-to-r from-[#2D333D] to-[#D4AF37] rounded-full" style={{ width: `${((compThreshold + 60) / 60) * 100}%` }}></div>
                      </div>
                    </div>
                    <div>
                      <label className="flex justify-between text-[10px] text-[#8E9299] mb-3 font-mono uppercase tracking-[1px]">
                        <span>Comp Ratio</span>
                        <span className="text-[#D4AF37] font-bold">{compRatio}:1</span>
                      </label>
                      <div className="relative h-1 bg-[#0A0B0E] rounded-full flex items-center">
                        <input type="range" min="1" max="20" step="0.5" value={compRatio} onChange={e => setCompRatio(parseFloat(e.target.value))} aria-label="Compressor Ratio" className="w-full absolute inset-0 opacity-0 cursor-pointer z-10" />
                        <div className="h-full bg-gradient-to-r from-[#2D333D] to-[#D4AF37] rounded-full" style={{ width: `${((compRatio - 1) / 19) * 100}%` }}></div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Makeup Gain Card */}
                <div className="bg-[#16181D] rounded-lg border border-[#2D333D] p-3.5 shadow-inner">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-5 h-5 rounded bg-[rgba(212,175,55,0.1)] flex items-center justify-center border border-[rgba(212,175,55,0.2)]">
                      <Activity className="w-3 h-3 text-[#D4AF37]" />
                    </div>
                    <span className="text-[11px] font-black text-[#E0E2E5] uppercase tracking-tighter">Makeup gain</span>
                  </div>
                  <div className="mb-4 bg-[#0A0B0E] p-2 rounded border border-[#2D333D] border-dashed">
                    <div className="text-[10px] font-mono text-red-500 font-black mb-1 flex items-center gap-2 uppercase tracking-tighter">
                      <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shadow-[0_0_8px_#ef4444]"></div>
                      Reduction Peak: -{(-20 * Math.log10(Math.max(maxEssReduction, 0.001))).toFixed(1)} dB
                    </div>
                  </div>
                  <div className="py-2">
                    <div className="relative h-2 bg-[#0A0B0E] rounded-full flex items-center mb-5 border border-[#2D333D]">
                      <input 
                        type="range" 
                        min="0.5" max="4.0" step="0.01" 
                        value={makeupGain} 
                        onChange={e => setMakeupGain(parseFloat(e.target.value))} 
                        aria-label="Makeup Gain" 
                        className="w-full absolute inset-0 opacity-0 cursor-pointer z-10" 
                      />
                      <div 
                        className="h-full bg-gradient-to-r from-[#2D333D] to-[#D4AF37] rounded-full shadow-[0_0_10px_rgba(212,175,55,0.2)] transition-all" 
                        style={{ width: `${((makeupGain - 0.5) / 3.5) * 100}%` }}
                      ></div>
                    </div>
                    <label className="flex justify-between text-[10px] text-[#D4AF37] font-mono font-black uppercase tracking-[1px]">
                      <span>Compensation</span>
                      <span>{(makeupGain >= 1.0 ? '+' : '') + (20 * Math.log10(makeupGain)).toFixed(1)} dB</span>
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* Export Card - Always visible or at bottom */}
            <div className="bg-[#16181D] rounded-xl border border-[#2D333D] p-4 shadow-2xl mt-auto sticky bottom-0">
              <div className="text-[9px] font-black uppercase tracking-[3px] text-[#4a4f59] mb-4 text-center">Export Configuration</div>
              
              <div className="grid grid-cols-2 gap-2 mb-4">
                {['wav', 'mp3'].map(fmt => (
                  <button
                    key={fmt}
                    onClick={() => setExportFormat(fmt as 'wav'|'mp3')}
                    className={`py-2 rounded text-[11px] font-black border uppercase transition-all ${exportFormat === fmt ? 'border-[#D4AF37] text-[#D4AF37] bg-[rgba(212,175,55,0.1)] shadow-[0_0_10px_rgba(212,175,55,0.2)]' : 'bg-[#000] border-[#2D333D] text-[#4a4f59] hover:border-[#8E9299]'}`}
                  >
                    {fmt} {fmt === 'mp3' && '(320k)'}
                  </button>
                ))}
              </div>
              
              <button 
                className="w-full py-5 bg-[#D4AF37] hover:bg-[#e6bf4a] text-black rounded-lg font-black text-[18px] uppercase tracking-tighter shadow-[0_8px_25px_rgba(212,175,55,0.3)] disabled:opacity-30 flex flex-col items-center justify-center transition-all group"
                disabled={!isLoaded || isExporting || isOptimizing || isNormalizing || isAnalyzing}
                onClick={handleExport}
              >
                <div className="flex items-center gap-3">
                  <Download className={`w-5 h-5 group-enabled:group-hover:translate-y-0.5 transition-transform ${isExporting ? 'animate-bounce' : ''}`} />
                  MASTER EXPORT
                </div>
                <span className="text-[8px] font-black opacity-60 tracking-[4px] mt-1">{isExporting ? 'PROCESSING...' : 'PRODUCTION COMPLETE'}</span>
              </button>

              {isExporting && (
                <div className="mt-4">
                  <div className="h-1 bg-[#0A0B0E] rounded-full overflow-hidden border border-[#2D333D]">
                    <div className="h-full bg-[#D4AF37] transition-all duration-300 shadow-[0_0_15px_#D4AF37]" style={{ width: `${exportProgress}%` }} />
                  </div>
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* Center Panel (Visualization) */}
        <section className="bg-[#0A0B0E] flex flex-col min-w-0 flex-1 md:overflow-hidden">
          <div className="h-[36px] min-h-[36px] px-3 flex items-center justify-between bg-[#16181D] border-b border-[#2D333D]">
            <div className="flex items-center gap-6">
              <div className="text-[9px] font-black uppercase tracking-[2px] text-[#4a4f59] flex flex-row items-center gap-2">
                Real-time Spectrum Analysis
              </div>
              
              {/* Volume Controller */}
              <div className="flex items-center gap-2 group/vol">
                <Volume2 className="w-3 h-3 text-[#4a4f59] group-hover/vol:text-[#D4AF37] transition-colors" />
                <div className="w-24 h-1.5 bg-[#0A0B0E] rounded-full relative flex items-center border border-[#2D333D]">
                  <input 
                    type="range" 
                    min="0" max="1" step="0.01" 
                    value={masterVolume} 
                    onChange={(e) => setMasterVolume(parseFloat(e.target.value))}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  />
                  <div 
                    className="h-full bg-gradient-to-r from-[#2D333D] to-[#D4AF37] rounded-full transition-all" 
                    style={{ width: `${masterVolume * 100}%` }}
                  ></div>
                </div>
                <span className="text-[8px] font-mono text-[#4a4f59] w-6 text-right">
                  {Math.round(masterVolume * 100)}%
                </span>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <span className="text-[10px] font-mono font-bold text-[#00F0FF] uppercase tracking-widest">
                {isPlaying ? 'PLAYING AUDIO' : 'ENGINE READY'}
              </span>
            </div>
          </div>

          <div className="flex-1 p-5 flex flex-col gap-4 min-h-0 md:overflow-hidden relative">
            {/* Synced Visualization Area */}
            <div className="relative border border-[#2D333D] rounded overflow-hidden">
              <div 
                ref={waveformContainerRef} 
                className="bg-[#000] overflow-hidden select-none cursor-pointer"
                onPointerDown={() => setIsScrubbing(true)}
                onPointerUp={(e) => {
                  setIsScrubbing(false);
                  if (wsRef.current && isLoaded) {
                    audioEngine.seek(wsRef.current.getCurrentTime());
                  }
                }}
              >
                {!isLoaded && !isAnalyzing && <div className="absolute inset-0 z-10 flex items-center justify-center text-[#8E9299] font-mono text-xs">AUDIO NOT LOADED</div>}
                {isAnalyzing && (
                   <div className="absolute inset-0 z-10 flex flex-col items-center justify-center text-[#00F0FF] bg-[rgba(0,0,0,0.7)] font-mono text-xs">
                      <div className="w-5 h-5 mb-2 border-2 border-[#00F0FF] border-t-transparent rounded-full animate-spin"></div>
                      치찰음 분석 중... (Analyzing...)
                   </div>
                )}

                <div className="flex flex-col relative" style={{ width: wsWidth > 0 ? `${wsWidth}px` : '100%' }}>
                  <div className="scanline-overlay"></div>
                  
                  {/* Waveform Section */}
                  <div 
                    className="relative h-[200px] shrink-0 overflow-hidden border-b border-[#2D333D]/50"
                    style={{ minWidth: '100%' }}
                  >
                    <div ref={waveformRef} className="h-full w-full" />
                    
                    {/* Sibilance Points Overlay */}
                    {isLoaded && audioDuration > 0 && wsRef.current && showAdvanced && (
                      <svg 
                        className="absolute inset-0 h-full pointer-events-none z-20"
                        style={{ width: '100%' }}
                      >
                        <defs>
                          <linearGradient id="bellGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#00F0FF" stopOpacity="0.4" />
                            <stop offset="100%" stopColor="#00F0FF" stopOpacity="0" />
                          </linearGradient>
                        </defs>
                        {sibilancePoints.map(pt => (
                          <SibilanceNode
                            key={pt.id}
                            pt={pt}
                            audioDuration={audioDuration}
                            wsWidth={wsWidth}
                            onGainChange={handleGainChange}
                            onWidthChange={handleWidthChange}
                          />
                        ))}
                      </svg>
                    )}
                  </div>

                  {/* Visualizer Area */}
                  <div className="relative h-[220px] shrink-0 border-t border-[#2D333D] bg-black overflow-hidden">
                    {/* Empty Black Section (Previously Spectrogram) */}
                    <div className="h-full w-full bg-black" />
                    
                    {/* Frequency Axis Labels (Neon Green for high visibility) */}
                    <div className="absolute inset-0 pointer-events-none z-10">
                      {[0, 5000, 10000, 15000, 20000].map((f) => {
                        const percent = (f / 20000) * 100;
                        return (
                          <div key={f} className="absolute left-0 w-full border-t border-[#39FF14]/20 flex items-center" style={{ bottom: `${percent}%` }}>
                            <span className="text-[8px] font-mono font-bold text-[#39FF14] ml-1 drop-shadow-[0_0_2px_rgba(0,0,0,1)]">
                              {f === 0 ? '20Hz' : (f/1000).toFixed(0) + 'kHz'}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Spectral EQ Interface Overlay */}
                    {showAdvanced && (
                      <svg className="absolute inset-0 w-full h-full pointer-events-none select-none z-20 overflow-visible">
                        {isLoaded && isPlaying && (
                          <line x1="50%" y1="0" x2="50%" y2="100%" stroke="rgba(0,240,255,0.05)" strokeWidth="1" strokeDasharray="10,5" />
                        )}
                        {isLoaded && eqParams.map((p, i) => {
                           const minFreq = 20;
                           const maxFreq = 20000;
                           const xPercent = ((Math.log10(p.freq) - Math.log10(minFreq)) / (Math.log10(maxFreq) - Math.log10(minFreq))) * 100;
                           const yPercent = 50 - (p.gain * 2); 
                           
                           return (
                             <g key={i} className="pointer-events-auto">
                                {focusedEQNode === i && (
                                  <>
                                    <line x1={`${xPercent}%`} y1="0" x2={`${xPercent}%`} y2="100%" stroke="rgba(0,240,255,0.2)" strokeWidth="1" strokeDasharray="4,4" />
                                    <line x1="0" y1={`${yPercent}%`} x2="100%" y2={`${yPercent}%`} stroke="rgba(255,255,255,0.15)" strokeWidth="1" strokeDasharray="10,5" />
                                  </>
                                )}
                                
                                <circle 
                                 cx={`${xPercent}%`} cy={`${yPercent}%`} r="8" 
                                 fill={focusedEQNode === i ? "#00F0FF" : "rgba(10,11,14,0.95)"} 
                                 stroke={focusedEQNode === i ? "#fff" : "rgba(255,240,255,0.4)"}
                                 strokeWidth="2"
                                 className="cursor-move filter drop-shadow-[0_0_10px_rgba(0,240,255,0.3)]"
                                 onMouseDown={(e) => {
                                   e.stopPropagation();
                                   e.preventDefault();
                                   const startY = e.clientY;
                                   const startX = e.clientX;
                                   const startG = p.gain;
                                   const startF = p.freq;
                                   
                                   const move = (me: MouseEvent) => {
                                     const dy = startY - me.clientY;
                                     const dx = me.clientX - startX;
                                     const newG = Math.round((startG + dy / 4) * 10) / 10;
                                     
                                     // Consistent Logarithmic Frequency Movement
                                     const minF = 20;
                                     const maxF = 20000;
                                     const logMin = Math.log10(minF);
                                     const logMax = Math.log10(maxF);
                                     const currentLogRange = logMax - logMin;
                                     const startLogPos = (Math.log10(startF) - logMin) / currentLogRange;
                                     const newLogPos = Math.max(0, Math.min(1, startLogPos + (dx / 600))); // Sensitivity based on width
                                     const newF = Math.pow(10, logMin + newLogPos * currentLogRange);
  
                                     setEqParams(prev => {
                                        const next = [...prev];
                                        next[i] = { ...next[i], gain: Math.max(-24, Math.min(24, newG)), freq: newF };
                                        return next;
                                     });
                                   };
                                   const up = () => {
                                     window.removeEventListener('mousemove', move);
                                     window.removeEventListener('mouseup', up);
                                   };
                                   window.addEventListener('mousemove', move);
                                   window.addEventListener('mouseup', up);
                                   setFocusedEQNode(i);
                                 }}
                               />
                               
                               <g style={{ transform: `translate(${xPercent}%, ${yPercent}%)` }}>
                                  <g transform="translate(0, -22)" className="pointer-events-none">
                                     <rect x="-35" y="-9" width="70" height="14" rx="2" fill="rgba(6, 7, 9, 0.95)" stroke={focusedEQNode === i ? "#00F0FF" : "#2D333D"} strokeWidth="1" />
                                     <text y="1" fill={focusedEQNode === i ? "#fff" : "#8E9299"} fontSize="8" fontWeight="900" textAnchor="middle" className="font-mono tracking-tighter">
                                       L{i+1}: {Math.round(p.freq)}Hz {p.gain > 0 ? '+' : ''}{p.gain.toFixed(1)}
                                     </text>
                                  </g>
                               </g>
                             </g>
                           );
                        })}
                      </svg>
                    )}
                  </div>
                </div>
              </div>
              
              {/* FIXED OVERLAY (Live Spectrum Analyzer) */}
              <div className="absolute bottom-0 left-0 w-full h-[220px] pointer-events-none z-30">
                <canvas ref={analyzerCanvasRef} className="w-full h-full" />
              </div>
            </div>
            
            <div className="flex flex-col gap-4">
              {/* Real-time PLR Meter Widget */}
              {isLoaded && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-[#151619] border border-[#2D333D] rounded-xl p-4 flex flex-col items-center justify-center relative overflow-hidden group">
                     {/* Background Glow */}
                     <div className={`absolute inset-0 transition-opacity duration-500 opacity-5 ${plrStatus === 'Commercial' ? 'bg-[#00F0FF] opacity-10' : plrStatus === 'Crushed' ? 'bg-[#FF4444]' : 'bg-[#D4AF37]'}`} />
                     
                     <div className="text-[10px] font-black text-[#8E9299] uppercase tracking-[2px] mb-2 z-10">Real-time PLR</div>
                     <div className={`text-3xl font-mono font-black tabular-nums tracking-tighter z-10 transition-colors ${plrStatus === 'Commercial' ? 'text-[#00F0FF] drop-shadow-[0_0_15px_rgba(0,240,255,0.4)]' : plrStatus === 'Crushed' ? 'text-[#FF4444]' : 'text-[#D4AF37]'}`}>
                        {plrValue.toFixed(1)}<span className="text-xs ml-1 opacity-50 uppercase tracking-normal">dB</span>
                     </div>
                     <div className={`mt-2 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest z-10 border transition-all ${plrStatus === 'Commercial' ? 'bg-[rgba(0,240,255,0.1)] border-[#00F0FF] text-[#00F0FF]' : plrStatus === 'Crushed' ? 'bg-[rgba(255,68,68,0.1)] border-[#FF4444] text-[#FF4444]' : 'bg-[rgba(212,175,55,0.1)] border-[#D4AF37] text-[#D4AF37]'}`}>
                        {plrStatus}
                     </div>
                  </div>

                  <div className="bg-[#151619] border border-[#2D333D] rounded-xl p-4 flex flex-col justify-center">
                    <div className="text-[9px] text-[#4a4f59] font-black uppercase tracking-[2px] mb-3">Dynamics Target</div>
                    <div className="space-y-1.5">
                       <div className="flex justify-between items-center text-[10px]">
                          <span className={plrStatus === 'Dynamic' ? 'text-[#D4AF37] font-bold' : 'text-[#4a4f59]'}>Dynamic (&gt;12.0)</span>
                          <div className={`w-1.5 h-1.5 rounded-full ${plrStatus === 'Dynamic' ? 'bg-[#D4AF37] shadow-[0_0_8px_#D4AF37]' : 'bg-[#16181D]'}`}></div>
                       </div>
                       <div className="flex justify-between items-center text-[10px]">
                          <span className={plrStatus === 'Commercial' ? 'text-[#00F0FF] font-bold' : 'text-[#4a4f59]'}>Commercial (8-10)</span>
                          <div className={`w-1.5 h-1.5 rounded-full ${plrStatus === 'Commercial' ? 'bg-[#00F0FF] shadow-[0_0_8px_#00F0FF]' : 'bg-[#16181D]'}`}></div>
                       </div>
                       <div className="flex justify-between items-center text-[10px]">
                          <span className={plrStatus === 'Crushed' ? 'text-[#FF4444] font-bold' : 'text-[#4a4f59]'}>Crushed (&lt;7.0)</span>
                          <div className={`w-1.5 h-1.5 rounded-full ${plrStatus === 'Crushed' ? 'bg-[#FF4444] shadow-[0_0_8px_#FF4444]' : 'bg-[#16181D]'}`}></div>
                       </div>
                    </div>
                  </div>
                </div>
              )}

              {isLoaded && audioDuration > 0 && (
                <div className="flex flex-col gap-4 p-5 bg-[#16181D] border border-[#2D333D] rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.4)] w-full">
                  <div className="flex items-center justify-between border-b border-[#2D333D] pb-4 mb-1">
                     <div className="flex items-center gap-3">
                       <div className="w-2 h-[14px] bg-[#00F0FF] rounded-full"></div>
                       <span className="text-[11px] font-black text-[#8E9299] uppercase tracking-[2px]">Detection Processor</span>
                       <IconTooltip message="우측으로 당길수록 미약한 소격까지 치찰음을 감지합니다. 파형 위의 노드를 직접 아래로 끌어 볼륨을 억제하세요." />
                     </div>
                     <div className="flex items-center gap-2 bg-[#0A0B0E] px-3 py-1 rounded-full border border-[#2D333D] shadow-inner">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#00F0FF] animate-pulse shadow-[0_0_8px_#00F0FF]"></span>
                        <span className="text-[10px] text-[#00F0FF] font-mono font-black tracking-widest leading-none">
                          {sibilancePoints.length} NODES IDENTIFIED
                        </span>
                     </div>
                  </div>
                  
                  <div className="flex items-center gap-5 px-4 bg-[#0A0B0E] py-4 rounded-lg border border-[#2D333D] shadow-inner">
                    <div className="text-[9px] text-[#4a4f59] font-black uppercase tracking-[2px] w-[50px]">Loose</div>
                    <div className="relative flex-1 h-[2px] bg-[#16181D] rounded-full">
                      <input type="range" min="1" max="100" value={pointSensitivity} onChange={(e) => setPointSensitivity(Number(e.target.value))} className="w-full absolute inset-0 opacity-0 cursor-pointer z-10" />
                      <div className="h-full bg-gradient-to-r from-[#2D333D] via-[#00F0FF] to-[#00F0FF] rounded-full" style={{ width: `${pointSensitivity}%` }}></div>
                      <div className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-[#0A0B0E] border-2 border-[#00F0FF] rounded-full shadow-[0_0_10px_rgba(0,240,255,0.5)] pointer-events-none transition-all duration-75" style={{ left: `calc(${pointSensitivity}% - 8px)` }}></div>
                    </div>
                    <div className="text-[9px] text-[#4a4f59] font-black uppercase tracking-[2px] w-[50px] text-right">Aggressive</div>
                  </div>
                  
                  <div className="flex flex-wrap lg:flex-nowrap justify-between items-center mt-2 border-t border-[#2D333D] pt-5 gap-4">
                    <div className="flex flex-wrap gap-3">
                      <button 
                        onClick={togglePlayback}
                        disabled={!isLoaded}
                        className={`group relative flex items-center justify-center px-8 py-3 rounded-md text-[13px] font-black tracking-[4px] transition-all uppercase ${isPlaying ? 'bg-[#00F0FF] text-black shadow-[0_0_25px_rgba(0,240,255,0.5)] scale-[1.02]' : 'bg-[#0A0B0E] border-2 border-[#00F0FF] text-[#00F0FF] hover:bg-[rgba(0,240,255,0.1)]'}`}
                        title="Play / Pause"
                      >
                        {isPlaying ? <Pause className="w-5 h-5 mr-3 fill-current" /> : <Play className="w-5 h-5 mr-3 fill-current ml-1" />}
                        {isPlaying ? 'PAUSE' : 'PLAY'}
                      </button>
                      
                      <div className="flex p-1 bg-[#0A0B0E] rounded-lg border border-[#2D333D] shadow-inner">
                        <button 
                          className={`px-4 rounded-md text-[10px] font-black tracking-widest transition-all uppercase ${mix === 0 ? 'bg-[#2D333D] text-[#00F0FF] shadow-sm' : 'text-[#4a4f59] hover:text-[#8E9299]'}`}
                          onClick={() => setMix(0)}
                        >
                          Dry Analysis
                        </button>
                        <button 
                          className={`px-4 rounded-md text-[10px] font-black tracking-widest transition-all uppercase ${mix === 1 ? 'bg-[#D4AF37] text-black shadow-[0_0_15px_rgba(212,175,55,0.4)]' : 'text-[#4a4f59] hover:text-[#8E9299]'}`}
                          onClick={() => setMix(1)}
                        >
                          Processed
                        </button>
                      </div>
                    </div>
                    
                    <div className="flex flex-wrap gap-2">
                      <button 
                        onClick={handleSmartOptimize}
                        disabled={!isLoaded || isOptimizing}
                        className={`flex-1 min-w-[280px] py-4 bg-gradient-to-r from-[#D4AF37] to-[#F3D060] text-black text-[14px] font-black uppercase tracking-[3px] rounded-xl transition-all flex items-center justify-center shadow-[0_10px_40px_rgba(212,175,55,0.3)] hover:shadow-[0_15px_50px_rgba(212,175,55,0.5)] hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:grayscale group relative overflow-hidden ${isOptimizing ? 'animate-pulse' : ''}`}
                      >
                        <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-10 transition-opacity"></div>
                        <Wand2 className={`w-5 h-5 mr-3 ${isOptimizing ? 'animate-spin' : 'group-hover:rotate-12 transition-transform'}`} />
                        <div className="flex flex-col items-start leading-none pt-1">
                          <span className="text-[16px] mb-0.5">{isOptimizing ? 'PREPARING...' : 'SMART PRE-MASTER'}</span>
                          <span className="text-[10px] opacity-60 font-black tracking-widest">AUTO PREP TO {targetLUFS} LUFS</span>
                        </div>
                      </button>

                      <div className="flex flex-col gap-2">
                        <div className="text-[9px] font-black text-[#4a4f59] uppercase tracking-[2px] ml-1">Target Loudness</div>
                        <div className="flex bg-[#111317] rounded-xl p-1.5 border border-[#2D333D] shadow-inner shrink-0">
                          <button 
                            onClick={() => setTargetLUFS(-14)}
                            className={`px-4 py-2 text-[10px] font-black rounded-lg transition-all ${targetLUFS === -14 ? 'bg-[#D4AF37] text-black shadow-lg' : 'text-[#8E9299] hover:text-white'}`}
                          >
                            -14 LUFS
                          </button>
                          <button 
                            onClick={() => setTargetLUFS(-16)}
                            className={`px-4 py-2 text-[10px] font-black rounded-lg transition-all ${targetLUFS === -16 ? 'bg-[#D4AF37] text-black shadow-lg' : 'text-[#8E9299] hover:text-white'}`}
                          >
                            -16 LUFS
                          </button>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2">
                        <div className="text-[9px] font-black text-[#4a4f59] uppercase tracking-[2px] ml-1">Control</div>
                        <button 
                          onClick={() => { userGainsRef.current = {}; setPointSensitivity(p => p === 100 ? 99 : 100); setTimeout(()=>setPointSensitivity(85), 10); }} 
                          className="h-[46px] px-6 bg-[#16181D] border border-[#2D333D] text-[#8E9299] text-[9px] font-black uppercase tracking-[1px] rounded-xl hover:bg-[#2D333D] hover:text-[#E0E2E5] transition-all flex items-center justify-center gap-2"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          RESET NODES
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {showAdvanced && (
                <div className="p-4 bg-[rgba(165,255,0,0.03)] border-2 border-[rgba(165,255,0,0.2)] border-dashed rounded-xl animate-in zoom-in-95 duration-300">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-8 h-8 rounded-lg bg-[rgba(165,255,0,0.1)] flex items-center justify-center">
                      <MousePointer2 className="w-4 h-4 text-[#A5FF00]" />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[12px] font-black text-[#A5FF00] tracking-tight">NODE CONTROL GUIDE</span>
                      <span className="text-[9px] text-[#4a4f59] font-bold uppercase tracking-widest leading-none">고급 노드 조절 가이드</span>
                    </div>
                  </div>
                  <div className="space-y-2.5">
                    <div className="flex gap-2">
                       <span className="text-[#A5FF00] text-[10px] font-black">●</span>
                       <p className="text-[10px] text-[#8E9299] leading-tight">
                        <strong className="text-[#E0E2E5]">상단 파형(Sibilance):</strong> 생성된 노드를 <span className="text-[#00F0FF] font-bold">상하(Gain)</span> 또는 <span className="text-[#00F0FF] font-bold">좌우(Width)</span>로 드래그하여 특정 구간의 치찰음을 직접 제거합니다.
                       </p>
                    </div>
                    <div className="flex gap-2">
                       <span className="text-[#A5FF00] text-[10px] font-black">●</span>
                       <p className="text-[10px] text-[#8E9299] leading-tight">
                        <strong className="text-[#E0E2E5]">하단 스펙트로그램(EQ):</strong> 5개의 마스터링 EQ 노드를 드래그하여 음색의 질감을 정밀하게 다듬으세요. 분석된 결과는 실시간으로 반영됩니다.
                       </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="p-3 bg-gradient-to-br from-[#0A0B0E] to-[#111317] border border-[rgba(0,240,255,0.3)] rounded-lg shadow-[0_4px_15px_rgba(0,240,255,0.1)]">
                <div className="flex items-center gap-3">
                  <div className="w-1.5 h-1.5 bg-[#00F0FF] rounded-full shadow-[0_0_8px_#00F0FF] animate-pulse"></div>
                  <span className="text-[13px] font-black text-[#00F0FF] tracking-tighter leading-tight drop-shadow-[0_0_5px_rgba(0,240,255,0.4)]">
                    수노 음원을 마스터링하기 편한 상태로 재가공합니다
                  </span>
                </div>
              </div>

              <div className="p-3 bg-[#111317] rounded border border-[#2D333D]">
                <div className="text-[11px] font-black text-[#8E9299] mb-1 uppercase tracking-wider flex items-center gap-2">
                  <Activity className="w-3 h-3 text-[#00F0FF]" /> 시각 가이드 (Visualization Guide)
                </div>
                <div className="text-[10px] text-[#4a4f59] leading-relaxed">
                  치찰음 감소가 실시간으로 자동으로 적용되어 있지만, 필요한 경우 상단 파형에서 치찰음 노드(L3)를 직접 제어하고, 하단 실시간 스펙트로그램(L1-L3)을 통해 보정 결과를 즉시 모니터링하세요. 
                  고음역대 주파수가 감쇄되는 양상을 시각적으로 확인할 수 있습니다.
                </div>
              </div>

              {/* Security / Privacy Card */}
              <div className="p-3 bg-[#0D0F13] border border-[#2D333D] rounded border-dashed">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#00F0FF] animate-pulse"></div>
                    <span className="text-[10px] font-black text-[#E0E2E5] tracking-widest uppercase">Privacy Secured</span>
                  </div>
                  <div className="text-[7px] font-black text-[#4a4f59] uppercase border border-[#2D333D] px-1.5 py-0.5 rounded tracking-[1px]">
                    100% LOCAL PROCESSING
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] text-[#00F0FF] font-black tracking-tight underline underline-offset-2 decoration-[#2D333D]">
                    100% 로컬 구동, 음원 외부 유출 없음
                  </p>
                  <p className="text-[9px] text-[#4a4f59] leading-relaxed font-medium">
                    정적 자원(HTML/JS/CSS)만으로 구성되어 있고, 서버 사이드 로직이나 DB, 외부 API 키가 전혀 필요 없는 <span className="text-[#8E9299]">Pure Client-Side App</span>입니다.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Persistent Status Bar */}
      <footer className="h-[30px] shrink-0 bg-[#0A0B0E] border-t border-[#2D333D] flex items-center justify-between px-5 relative">
        <div className="flex items-center gap-4 text-[9px] font-mono text-[#4a4f59] uppercase tracking-widest">
          <span>Engine: Ready</span>
          <span>Buffer: Optimized</span>
          <span>Sample: 44.1kHz</span>
        </div>

        <div className="absolute left-1/2 -translate-x-1/2 text-[9px] font-mono font-bold text-[#8E9299] opacity-40 tracking-[3px] pointer-events-none uppercase">
          Created by 그런거죠
        </div>

        <div className="text-[9px] font-mono text-[#4a4f59]">
          SYSTEM_STABLE: OK
        </div>
      </footer>
      {/* Usage Manual & Caution Modal */}
      {showManual && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-[#16181D] border border-[#2D333D] rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto shadow-[0_0_50px_rgba(0,0,0,0.5)] custom-scrollbar">
            <div className="sticky top-0 bg-[#16181D] p-6 border-b border-[#2D333D] flex justify-between items-center z-10">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[rgba(0,240,255,0.1)] flex items-center justify-center">
                  <Info className="w-5 h-5 text-[#00F0FF]" />
                </div>
                <div>
                  <h2 className="text-lg font-black tracking-tight uppercase">Usage & Caution (사용법 및 주의사항)</h2>
                  <p className="text-[10px] text-[#4a4f59] font-bold uppercase tracking-widest leading-none mt-1">Operational Safety Protocol</p>
                </div>
              </div>
              <button onClick={() => setShowManual(false)} className="p-2 hover:bg-[#2D333D] rounded-full transition-colors text-[#8E9299]">
                <RotateCcw className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-8">
              {/* Quick Start Section */}
              <section className="space-y-4">
                <div className="flex items-center gap-2 text-[#00F0FF]">
                  <Wand2 className="w-4 h-4" />
                  <h3 className="text-xs font-black uppercase tracking-wider">Quick Start Guide</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {[
                    { step: '01', title: 'IMPORT', desc: 'Suno AI에서 생성된 WAV/MP3 파일을 업로드합니다.' },
                    { step: '02', title: 'AUTO PREP', desc: 'Smart Pre-Master 버튼을 눌러 AI 최적화 가공을 시작합니다.' },
                    { step: '03', title: 'EXPORT', desc: '가공된 고품질 음원을 원하는 포맷으로 내보내기 합니다.' }
                  ].map(s => (
                    <div key={s.step} className="bg-[#0A0B0E] p-4 rounded-xl border border-[#2D333D]">
                      <div className="text-[10px] font-black text-[#4a4f59] mb-1">{s.step}</div>
                      <div className="text-[11px] font-black text-[#E0E2E5] mb-1">{s.title}</div>
                      <div className="text-[10px] text-[#8E9299] leading-tight">{s.desc}</div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Harsh Truths / Caution Section (Colorblind Friendly) */}
              <section className="space-y-4">
                <div className="flex items-center gap-2 text-[#D4AF37]">
                   <AlertCircle className="w-4 h-4" />
                   <h3 className="text-xs font-black uppercase tracking-wider">Crucial Cautions & Technical Limits</h3>
                </div>
                
                <div className="space-y-3">
                  <div className="flex gap-4 p-4 rounded-xl bg-[rgba(212,175,55,0.05)] border border-[rgba(212,175,55,0.2)]">
                    <div className="shrink-0 w-10 h-10 rounded-lg bg-[#0A0B0E] flex items-center justify-center text-[#D4AF37] font-black border border-[rgba(212,175,55,0.2)] text-lg">!</div>
                    <div>
                      <div className="text-[11px] font-black text-[#D4AF37] mb-1 uppercase">[주의] 모바일 및 저사양 장비 메모리 한계</div>
                      <p className="text-[11px] text-[#E0E2E5] leading-relaxed">
                        본 앱은 오디오 데이터를 브라우저 메모리에 직접 로드하여 처리합니다. 5분 이상의 고해상도 파일을 모바일(iPhone/Safari 등)에서 사용 시 탭이 꺼질 수 있습니다. 안정적인 작업을 위해 <b>PC 환경 권장</b>합니다.
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-4 p-4 rounded-xl bg-[rgba(0,240,255,0.05)] border border-[rgba(0,240,255,0.2)]">
                    <div className="shrink-0 w-10 h-10 rounded-lg bg-[#0A0B0E] flex items-center justify-center text-[#00F0FF] font-black border border-[rgba(0,240,255,0.2)] text-lg">!</div>
                    <div>
                      <div className="text-[11px] font-black text-[#00F0FF] mb-1 uppercase">[공학적 한계] 다이내믹 펌핑 현상</div>
                      <p className="text-[11px] text-[#E0E2E5] leading-relaxed">
                        실시간 PLR 기반 분석 중, 벌스와 코러스의 볼륨 차가 극심한 곡은 컴프레서 레벨이 요동치는 '펌핑' 현상이 생길 수 있습니다. 이 경우 Advanced Settings에서 <b>Threshold를 직접 상향 조정</b>하십시오.
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-4 p-4 rounded-xl bg-[rgba(224,226,229,0.05)] border border-[#2D333D]">
                    <div className="shrink-0 w-10 h-10 rounded-lg bg-[#0A0B0E] flex items-center justify-center text-[#8E9299] font-black border border-[#2D333D] text-lg">!</div>
                    <div>
                      <div className="text-[11px] font-black text-[#8E9299] mb-1 uppercase">[퍼포먼스] MP3 추출 시 프리징</div>
                      <p className="text-[11px] text-[#E0E2E5] leading-relaxed">
                        MP3 내보내기 연산은 CPU 자원을 집중 사용합니다. 변환 중 화면이 몇 초간 멈춘 것처럼 보일 수 있습니다. 정상적인 연산 과정이므로 <b>창을 닫지 말고 잠시 기다려 주십시오.</b>
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-4 p-4 rounded-xl bg-[#0A0B0E] border border-[#2D333D]">
                    <div className="shrink-0 w-10 h-10 rounded-lg bg-[#16181D] flex items-center justify-center text-[#4a4f59] font-black border border-[#2D333D] text-lg">i</div>
                    <div>
                      <div className="text-[11px] font-black text-[#4a4f59] mb-1 uppercase">[용어 정의] 본 앱의 AI 기능에 대하여</div>
                      <p className="text-[11px] text-[#8E9299] leading-relaxed italic">
                        본 앱은 Neural Network 기반 복원 모델이 아닌, AI 생성 음원의 결함을 보정하기 위해 정교하게 설계된 <b>고급 하드코딩 DSP(Digital Signal Processing) 체인</b>입니다. 딥러닝 기반 기능과는 차이가 있음을 알려드립니다.
                      </p>
                    </div>
                  </div>
                </div>
              </section>
            </div>

            <div className="p-6 bg-[#0A0B0E] border-t border-[#2D333D]">
              <button 
                onClick={() => setShowManual(false)}
                className="w-full py-4 bg-[#D4AF37] text-black font-black text-[13px] uppercase tracking-[4px] rounded-xl shadow-[0_0_20px_rgba(212,175,55,0.2)] hover:scale-[1.01] active:scale-[0.99] transition-all"
              >
                PROTOCOL ACKNOWLEDGED
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
