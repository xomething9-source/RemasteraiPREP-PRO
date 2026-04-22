export const audioProcessorCode = `
class VocalProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'gateThreshold', defaultValue: 0.02, minValue: 0, maxValue: 1 },
      { name: 'gateRatio', defaultValue: 4, minValue: 1, maxValue: 20 },
      { name: 'gateBypass', defaultValue: 0, minValue: 0, maxValue: 1 },
      { name: 'deEsserThreshold', defaultValue: 0.1, minValue: 0, maxValue: 1 },
      { name: 'deEsserAmount', defaultValue: 0.5, minValue: 0, maxValue: 1 },
      { name: 'deEsserBypass', defaultValue: 0, minValue: 0, maxValue: 1 },
    ];
  }

  constructor() {
    super();
    this.envGate = [];
    this.smoothGateGain = [];
    this.envEss = [];
    this.smoothEssGain = [];
    this.lpState = [];
    
    // Calculate smoothing coefficients based on global sampleRate
    const sr = sampleRate;
    this.gateAttack = 1.0 - Math.exp(-1.0 / (0.005 * sr)); // 5ms attack
    this.gateRelease = 1.0 - Math.exp(-1.0 / (0.450 * sr)); // 450ms natural log-release for professional pre-master prep
    
    this.essAttack = 1.0 - Math.exp(-1.0 / (0.0003 * sr)); // 0.3ms ULTRA fast attack
    this.essRelease = 1.0 - Math.exp(-1.0 / (0.070 * sr)); // 70ms responsive release
    
    // 2-pole Butterworth Filter coefficients for sharper crossover at ~6500Hz
    // High crossover ensures the 4kHz-5kHz presence band is completely untouched
    const f = 6500 / sr;
    const q = 0.707;
    const r = Math.tan(Math.PI * f);
    const r2 = r * r;
    const g = r2 + r / q + 1;
    this.b0_lp = r2 / g;
    this.b1_lp = 2 * this.b0_lp;
    this.b2_lp = this.b0_lp;
    this.b0_hp = 1 / g;
    this.b1_hp = -2 / g;
    this.b2_hp = 1 / g;
    this.a1 = 2 * (r2 - 1) / g;
    this.a2 = (r2 - r / q + 1) / g;
    
    this.lastMsgTime = 0;
  }

  process(inputs, outputs, parameters) {
    const dryInput = inputs[0]; // Delayed original signal
    const essInput = inputs[1]; // High-passed signal for sibilance detection
    const output = outputs[0];

    if (!dryInput || dryInput.length === 0 || dryInput[0].length === 0) return true;

    const channels = dryInput.length;
    const blockSize = dryInput[0].length;
    
    // Initialize channel states if missing
    while (this.envGate.length < channels) {
      this.envGate.push(0);
      this.smoothGateGain.push(1.0);
      this.envEss.push(0);
      this.smoothEssGain.push(1.0);
      this.lpState.push(new Float32Array(8)); // x_lp1, x_lp2, y_lp1, y_lp2, x_hp1, x_hp2, y_hp1, y_hp2
    }
    
    const gateThreshArr = parameters.gateThreshold;
    const gateRatioArr = parameters.gateRatio;
    const essThreshArr = parameters.deEsserThreshold;
    const essAmtArr = parameters.deEsserAmount;
    
    const gateBypassArr = parameters.gateBypass;
    const essBypassArr = parameters.deEsserBypass;

    const gT_is_arr = gateThreshArr.length > 1;
    const gR_is_arr = gateRatioArr.length > 1;
    const gB_is_arr = gateBypassArr.length > 1;
    const eT_is_arr = essThreshArr.length > 1;
    const eA_is_arr = essAmtArr.length > 1;
    const eB_is_arr = essBypassArr.length > 1;

    const gT_stat = gateThreshArr[0];
    const gR_stat = gateRatioArr[0];
    const gB_stat = gateBypassArr[0];
    const eT_stat = essThreshArr[0];
    const eA_stat = essAmtArr[0];
    const eB_stat = essBypassArr[0];

    const gateAttack = this.gateAttack;
    const gateRelease = this.gateRelease;
    const essAttack = this.essAttack;
    const essRelease = this.essRelease;
    const b0_lp = this.b0_lp, b1_lp = this.b1_lp, b2_lp = this.b2_lp;
    const b0_hp = this.b0_hp, b1_hp = this.b1_hp, b2_hp = this.b2_hp;
    const a1 = this.a1, a2 = this.a2;

    for (let c = 0; c < channels; c++) {
      const inChannel = dryInput[c];
      const essChannel = (essInput && essInput.length > c) ? essInput[c] : inChannel;
      const output = outputs[0];
      const outChannel = output[c];
      const s = this.lpState[c];
      let envGate = this.envGate[c];
      let smoothGateGain = this.smoothGateGain[c];
      let envEss = this.envEss[c];
      let smoothEssGain = this.smoothEssGain[c];

      for (let i = 0; i < blockSize; i++) {
        const gT = gT_is_arr ? gateThreshArr[i] : gT_stat;
        const gR = gR_is_arr ? gateRatioArr[i] : gR_stat;
        const gB = gB_is_arr ? gateBypassArr[i] : gB_stat;
        const eT = eT_is_arr ? essThreshArr[i] : eT_stat;
        const eA = eA_is_arr ? essAmtArr[i] : eA_stat;
        const eB = eB_is_arr ? essBypassArr[i] : eB_stat;

        const inSample = inChannel[i];

        // 2-pole LP Branch
        const lowBand = b0_lp * inSample + b1_lp * s[0] + b2_lp * s[1] - a1 * s[2] - a2 * s[3];
        s[1] = s[0]; s[0] = inSample;
        s[3] = s[2]; s[2] = lowBand;

        // 2-pole HP Branch
        const highBand_orig = b0_hp * inSample + b1_hp * s[4] + b2_hp * s[5] - a1 * s[6] - a2 * s[7];
        s[5] = s[4]; s[4] = inSample;
        s[7] = s[6]; s[6] = highBand_orig;

        let highBand = highBand_orig;
        
        if (channels === 2) {
          const sideBoost = 0.20; 
          if (c === 0) highBand *= (1 + sideBoost); 
          else highBand *= (1 - sideBoost); 
        }

        const absIn = inSample < 0 ? -inSample : inSample;
        const gateCoef = absIn > envGate ? gateAttack : gateRelease;
        envGate += (absIn - envGate) * gateCoef;

        let targetGateGain = 1.0;
        if (envGate < gT && gT > 0 && gB < 0.5) {
          const ratio = (envGate < 1e-5 ? 1e-5 : envGate) / gT;
          targetGateGain = Math.pow(ratio, gR - 1);
        }
        smoothGateGain += (targetGateGain - smoothGateGain) * (targetGateGain < smoothGateGain ? gateAttack : gateRelease);

        const absEss = essChannel[i] < 0 ? -essChannel[i] : essChannel[i];
        const essCoef = absEss > envEss ? essAttack : essRelease;
        envEss += (absEss - envEss) * essCoef;

        let targetEssGain = 1.0;
        if (envEss > eT * 0.7 && eT > 0 && eB < 0.5) {
           const kneeWidth = eT * 0.3;
           const excess = (envEss - (eT - kneeWidth)) / (kneeWidth + eT);
           const reduction = (excess > 1.0 ? 1.0 : excess) * eA;
           targetEssGain = 1.0 - (reduction * 0.85); 
        }
        smoothEssGain += (targetEssGain - smoothEssGain) * (targetEssGain < smoothEssGain ? essAttack : essRelease * 0.8);

        let mixed = (lowBand + highBand * smoothEssGain) * smoothGateGain;
        
        outChannel[i] = mixed;
        
        // Report reduction (channel 0 only for meter)
        if (c === 0 && i % 128 === 0) {
          const now = currentTime;
          if (now - this.lastMsgTime > 0.033) { // ~30Hz
            this.lastMsgTime = now;
            this.port.postMessage({ 
              type: 'reduction', 
              totalReduction: smoothGateGain * smoothEssGain,
              esserReduction: smoothEssGain 
            });
          }
        }
      }
      this.envGate[c] = envGate;
      this.smoothGateGain[c] = smoothGateGain;
      this.envEss[c] = envEss;
      this.smoothEssGain[c] = smoothEssGain;
    }

    return true;
  }
}

registerProcessor('vocal-processor', VocalProcessor);
`;
