class HarmonySinger {
    constructor() {
        this.audioContext = null;
        this.mediaStream = null;
        this.analyser = null;
        this.oscillator = null;
        this.gainNode = null;
        this.isListening = false;
        this.pitchDetector = null;
        
        this.initializeElements();
        this.setupEventListeners();
    }

    initializeElements() {
        this.startBtn = document.getElementById('startBtn');
        this.stopBtn = document.getElementById('stopBtn');
        this.status = document.getElementById('status');
        this.harmonyType = document.getElementById('harmonyType');
        this.volumeControl = document.getElementById('volume');
        this.detectedNote = document.getElementById('detectedNote');
        this.harmonyNote = document.getElementById('harmonyNote');
        this.volumeLevel = document.getElementById('volumeLevel');
    }

    setupEventListeners() {
        this.startBtn.addEventListener('click', () => this.startListening());
        this.stopBtn.addEventListener('click', () => this.stopListening());
        this.harmonyType.addEventListener('change', () => this.updateHarmony());
        this.volumeControl.addEventListener('input', () => this.updateVolume());
    }

    async startListening() {
        try {
            this.status.textContent = 'Requesting microphone access...';
            
            // Resume audio context if suspended (required on some browsers)
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }
            
            // List available audio devices for debugging
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioInputs = devices.filter(device => device.kind === 'audioinput');
            console.log('Available microphones:', audioInputs);
            
            this.mediaStream = await navigator.mediaDevices.getUserMedia({ 
                audio: { 
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                    sampleRate: 44100,
                    channelCount: 1
                } 
            });

            // Check if we actually got a stream
            const tracks = this.mediaStream.getAudioTracks();
            console.log('Audio tracks:', tracks);
            if (tracks.length === 0) {
                throw new Error('No audio tracks found');
            }
            
            const source = this.audioContext.createMediaStreamSource(this.mediaStream);
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 4096;
            this.analyser.smoothingTimeConstant = 0.3;
            this.analyser.minDecibels = -90;
            this.analyser.maxDecibels = -10;
            
            source.connect(this.analyser);

            this.gainNode = this.audioContext.createGain();
            this.gainNode.connect(this.audioContext.destination);
            this.updateVolume();

            this.isListening = true;
            this.startBtn.disabled = true;
            this.stopBtn.disabled = false;
            this.status.textContent = `Microphone connected (${this.audioContext.sampleRate} Hz)`;

            this.startPitchDetection();
            
        } catch (error) {
            console.error('Error accessing microphone:', error);
            this.status.textContent = `Error: ${error.message}. Check mic permissions.`;
        }
    }

    stopListening() {
        this.isListening = false;
        
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
        }
        
        if (this.oscillator) {
            this.oscillator.stop();
            this.oscillator = null;
        }
        
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }

        this.startBtn.disabled = false;
        this.stopBtn.disabled = true;
        this.status.textContent = 'Stopped listening';
        
        this.detectedNote.textContent = '-';
        this.harmonyNote.textContent = '-';
        this.volumeLevel.textContent = '-';
    }

    startPitchDetection() {
        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        const timeDataArray = new Float32Array(this.analyser.fftSize);
        
        const detectPitch = () => {
            if (!this.isListening) return;
            
            this.analyser.getByteFrequencyData(dataArray);
            this.analyser.getFloatTimeDomainData(timeDataArray);
            
            const volume = this.getRMS(timeDataArray);
            this.volumeLevel.textContent = (volume * 1000).toFixed(1);
            
            if (volume > 0.005) {
                const frequency = this.autoCorrelate(timeDataArray);
                
                if (frequency > 80 && frequency < 2000) {
                    const note = this.frequencyToNote(frequency);
                    const harmonyFreq = this.calculateHarmony(frequency);
                    const harmonyNoteObj = this.frequencyToNote(harmonyFreq);
                    
                    this.detectedNote.textContent = `${note.name} (${frequency.toFixed(1)} Hz)`;
                    this.harmonyNote.textContent = `${harmonyNoteObj.name} (${harmonyFreq.toFixed(1)} Hz)`;
                    
                    this.playHarmony(harmonyFreq);
                } else {
                    this.detectedNote.textContent = 'Pitch unclear';
                    this.harmonyNote.textContent = '-';
                    this.stopCurrentHarmony();
                }
            } else {
                this.detectedNote.textContent = 'Volume too low';
                this.harmonyNote.textContent = '-';
                this.stopCurrentHarmony();
            }
            
            requestAnimationFrame(detectPitch);
        };
        
        detectPitch();
    }

    getRMS(buffer) {
        let rms = 0;
        let maxVal = 0;
        for (let i = 0; i < buffer.length; i++) {
            const val = Math.abs(buffer[i]);
            rms += buffer[i] * buffer[i];
            maxVal = Math.max(maxVal, val);
        }
        const rmsValue = Math.sqrt(rms / buffer.length);
        
        // Debug logging every 60 frames (about once per second)
        if (this.debugCounter === undefined) this.debugCounter = 0;
        this.debugCounter++;
        if (this.debugCounter % 60 === 0) {
            console.log(`Audio levels - RMS: ${rmsValue.toFixed(4)}, Max: ${maxVal.toFixed(4)}`);
        }
        
        return rmsValue;
    }

    autoCorrelate(buffer) {
        const sampleRate = this.audioContext.sampleRate;
        const SIZE = buffer.length;
        const MIN_SAMPLES = Math.floor(sampleRate / 2000);
        const MAX_SAMPLES = Math.floor(sampleRate / 80);
        let best_offset = -1;
        let best_correlation = 0;
        const GOOD_ENOUGH_CORRELATION = 0.5;

        for (let offset = MIN_SAMPLES; offset <= MAX_SAMPLES && offset < SIZE; offset++) {
            let correlation = 0;
            let count = 0;
            
            for (let i = 0; i < SIZE - offset; i++) {
                correlation += buffer[i] * buffer[i + offset];
                count++;
            }
            
            if (count > 0) {
                correlation = correlation / count;
                
                if (correlation > best_correlation) {
                    best_correlation = correlation;
                    best_offset = offset;
                }
                
                if (correlation > GOOD_ENOUGH_CORRELATION && best_offset > 0) {
                    break;
                }
            }
        }
        
        if (best_correlation > 0.01 && best_offset > 0) {
            return sampleRate / best_offset;
        }
        return -1;
    }

    frequencyToNote(frequency) {
        const A4 = 440;
        const C0 = A4 * Math.pow(2, -4.75);
        const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
        
        if (frequency > 0) {
            const h = Math.round(12 * Math.log2(frequency / C0));
            const octave = Math.floor(h / 12);
            const n = h % 12;
            return {
                name: noteNames[n] + octave,
                note: noteNames[n],
                octave: octave,
                frequency: frequency
            };
        }
        return { name: "Unknown", note: "Unknown", octave: 0, frequency: 0 };
    }

    calculateHarmony(baseFrequency) {
        const harmonyType = this.harmonyType.value;
        
        switch (harmonyType) {
            case 'third':
                return baseFrequency * Math.pow(2, 4/12);
            case 'minorThird':
                return baseFrequency * Math.pow(2, 3/12);
            case 'fifth':
                return baseFrequency * Math.pow(2, 7/12);
            case 'octave':
                return baseFrequency * 2;
            default:
                return baseFrequency * Math.pow(2, 4/12);
        }
    }

    playHarmony(frequency) {
        if (this.oscillator) {
            this.oscillator.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
        } else {
            this.oscillator = this.audioContext.createOscillator();
            this.oscillator.type = 'sine';
            this.oscillator.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
            
            const envelope = this.audioContext.createGain();
            envelope.gain.setValueAtTime(0, this.audioContext.currentTime);
            envelope.gain.linearRampToValueAtTime(1, this.audioContext.currentTime + 0.1);
            
            this.oscillator.connect(envelope);
            envelope.connect(this.gainNode);
            
            this.oscillator.start();
        }
    }

    stopCurrentHarmony() {
        if (this.oscillator) {
            const envelope = this.audioContext.createGain();
            envelope.gain.setValueAtTime(1, this.audioContext.currentTime);
            envelope.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 0.1);
            
            this.oscillator.disconnect();
            this.oscillator.connect(envelope);
            envelope.connect(this.gainNode);
            
            setTimeout(() => {
                if (this.oscillator) {
                    this.oscillator.stop();
                    this.oscillator = null;
                }
            }, 100);
        }
    }

    updateHarmony() {
        if (this.isListening) {
            this.status.textContent = `Listening with ${this.harmonyType.options[this.harmonyType.selectedIndex].text} harmony`;
        }
    }

    updateVolume() {
        if (this.gainNode) {
            const volume = this.volumeControl.value / 100;
            this.gainNode.gain.setValueAtTime(volume, this.audioContext.currentTime);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new HarmonySinger();
});