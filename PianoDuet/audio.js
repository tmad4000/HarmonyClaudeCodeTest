// Audio Engine using Web Audio API
class PianoAudio {
    constructor() {
        this.audioContext = null;
        this.masterGain = null;
        this.volume = 0.7;
        this.activeNotes = new Map();
        this.initialized = false;
        this.tuningSystem = 'equal'; // 'equal' or 'just'
        this.rootKey = 'C'; // The key for just intonation

        // Just intonation ratios relative to the root (tonic)
        // These are the pure intervals based on harmonic series
        this.justRatios = {
            0: 1,        // Unison (1:1)
            1: 16/15,    // Minor second (16:15)
            2: 9/8,      // Major second (9:8)
            3: 6/5,      // Minor third (6:5)
            4: 5/4,      // Major third (5:4)
            5: 4/3,      // Perfect fourth (4:3)
            6: 45/32,    // Tritone (45:32)
            7: 3/2,      // Perfect fifth (3:2)
            8: 8/5,      // Minor sixth (8:5)
            9: 5/3,      // Major sixth (5:3)
            10: 9/5,     // Minor seventh (9:5)
            11: 15/8     // Major seventh (15:8)
        };
    }

    setTuning(tuning) {
        this.tuningSystem = tuning;
    }

    setKey(key) {
        this.rootKey = key;
    }

    async init() {
        if (this.initialized) return;

        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGain = this.audioContext.createGain();
        this.masterGain.connect(this.audioContext.destination);
        this.masterGain.gain.value = this.volume;

        // Create a compressor for better sound
        this.compressor = this.audioContext.createDynamicsCompressor();
        this.compressor.threshold.value = -20;
        this.compressor.knee.value = 30;
        this.compressor.ratio.value = 4;
        this.compressor.attack.value = 0.003;
        this.compressor.release.value = 0.25;
        this.compressor.connect(this.masterGain);

        this.initialized = true;
    }

    setVolume(value) {
        this.volume = value;
        if (this.masterGain) {
            this.masterGain.gain.setTargetAtTime(value, this.audioContext.currentTime, 0.01);
        }
    }

    // Convert note name to frequency
    noteToFrequency(note) {
        const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const noteName = note.slice(0, -1);
        const octave = parseInt(note.slice(-1));
        const semitone = notes.indexOf(noteName);

        if (this.tuningSystem === 'just') {
            return this.noteToFrequencyJust(noteName, octave, semitone, notes);
        }

        // Equal temperament: A4 = 440Hz, which is 9 semitones from C4
        const semitonesFromA4 = (octave - 4) * 12 + semitone - 9;
        return 440 * Math.pow(2, semitonesFromA4 / 12);
    }

    // Calculate frequency using just intonation relative to the selected key
    noteToFrequencyJust(noteName, octave, semitone, notes) {
        const rootSemitone = notes.indexOf(this.rootKey);

        // Calculate the root frequency in the given octave using equal temperament
        // We use A4 = 440Hz as our reference
        const rootOctave = octave;
        const rootSemitonesFromA4 = (rootOctave - 4) * 12 + rootSemitone - 9;
        const rootFreq = 440 * Math.pow(2, rootSemitonesFromA4 / 12);

        // Calculate interval from root (in semitones, wrapping within octave)
        let intervalFromRoot = semitone - rootSemitone;
        let octaveAdjustment = 0;

        if (intervalFromRoot < 0) {
            intervalFromRoot += 12;
            octaveAdjustment = -1;
        }

        // Get the just intonation ratio for this interval
        const ratio = this.justRatios[intervalFromRoot];

        // Calculate frequency: root * ratio * octave adjustment
        const freq = rootFreq * ratio * Math.pow(2, octaveAdjustment);

        return freq;
    }

    // Create a rich piano-like sound
    createPianoTone(frequency, velocity = 0.8) {
        const now = this.audioContext.currentTime;

        // Main oscillator setup
        const oscillators = [];
        const gains = [];

        // Fundamental frequency
        const osc1 = this.audioContext.createOscillator();
        osc1.type = 'triangle';
        osc1.frequency.value = frequency;
        oscillators.push(osc1);

        // First harmonic (octave)
        const osc2 = this.audioContext.createOscillator();
        osc2.type = 'sine';
        osc2.frequency.value = frequency * 2;
        oscillators.push(osc2);

        // Second harmonic
        const osc3 = this.audioContext.createOscillator();
        osc3.type = 'sine';
        osc3.frequency.value = frequency * 3;
        oscillators.push(osc3);

        // Third harmonic (very quiet)
        const osc4 = this.audioContext.createOscillator();
        osc4.type = 'sine';
        osc4.frequency.value = frequency * 4;
        oscillators.push(osc4);

        // Gain for each oscillator
        const gains1 = [0.5, 0.25, 0.1, 0.05];

        // Main envelope
        const envelope = this.audioContext.createGain();
        envelope.gain.value = 0;

        // Attack
        envelope.gain.setTargetAtTime(velocity, now, 0.005);
        // Decay
        envelope.gain.setTargetAtTime(velocity * 0.7, now + 0.1, 0.15);

        // Connect oscillators through individual gains
        oscillators.forEach((osc, i) => {
            const gain = this.audioContext.createGain();
            gain.gain.value = gains1[i];
            osc.connect(gain);
            gain.connect(envelope);
            gains.push(gain);
        });

        // Add a subtle low-pass filter for warmth
        const filter = this.audioContext.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = Math.min(frequency * 8, 8000);
        filter.Q.value = 1;

        envelope.connect(filter);
        filter.connect(this.compressor);

        // Start all oscillators
        oscillators.forEach(osc => osc.start(now));

        return {
            oscillators,
            gains,
            envelope,
            filter,
            stop: (releaseTime = 0.3) => {
                const stopTime = this.audioContext.currentTime;
                envelope.gain.cancelScheduledValues(stopTime);
                envelope.gain.setTargetAtTime(0, stopTime, releaseTime / 5);

                oscillators.forEach(osc => {
                    osc.stop(stopTime + releaseTime);
                });
            }
        };
    }

    playNote(note, velocity = 0.8, isAI = false) {
        if (!this.initialized) return null;

        // Resume context if suspended (browser autoplay policy)
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }

        const frequency = this.noteToFrequency(note);
        const tone = this.createPianoTone(frequency, velocity * (isAI ? 0.6 : 1));

        const noteKey = `${note}_${isAI ? 'ai' : 'user'}`;

        // Stop any existing note with the same key
        if (this.activeNotes.has(noteKey)) {
            this.activeNotes.get(noteKey).stop(0.05);
        }

        this.activeNotes.set(noteKey, tone);

        return tone;
    }

    stopNote(note, isAI = false) {
        const noteKey = `${note}_${isAI ? 'ai' : 'user'}`;

        if (this.activeNotes.has(noteKey)) {
            this.activeNotes.get(noteKey).stop();
            this.activeNotes.delete(noteKey);
        }
    }

    stopAllNotes() {
        this.activeNotes.forEach(tone => tone.stop(0.1));
        this.activeNotes.clear();
    }
}

// Export for use in other files
window.PianoAudio = PianoAudio;
