// Main Piano Controller
class Piano {
    constructor() {
        this.audio = new PianoAudio();
        this.accompaniment = new AccompanimentEngine(this.audio);
        this.keys = new Map();
        this.pressedKeys = new Set();
        this.duetMode = false;

        // Define the piano layout - 3 octaves
        this.notes = [
            // Octave 3
            'C3', 'C#3', 'D3', 'D#3', 'E3', 'F3', 'F#3', 'G3', 'G#3', 'A3', 'A#3', 'B3',
            // Octave 4
            'C4', 'C#4', 'D4', 'D#4', 'E4', 'F4', 'F#4', 'G4', 'G#4', 'A4', 'A#4', 'B4',
            // Octave 5
            'C5', 'C#5', 'D5', 'D#5', 'E5', 'F5', 'F#5', 'G5', 'G#5', 'A5', 'A#5', 'B5'
        ];

        // Keyboard mapping - two rows for playing
        // Lower row (ASDF...) maps to lower octave, upper row (QWER...) maps to higher
        this.keyboardMap = {
            // Lower row - C3 to B4
            'a': 'C3', 'w': 'C#3', 's': 'D3', 'e': 'D#3', 'd': 'E3',
            'f': 'F3', 't': 'F#3', 'g': 'G3', 'y': 'G#3', 'h': 'A3', 'u': 'A#3', 'j': 'B3',
            'k': 'C4', 'o': 'C#4', 'l': 'D4', 'p': 'D#4', ';': 'E4', "'": 'F4',

            // Upper row shifted - continuing pattern for higher notes
            'z': 'C4', 'x': 'D4', 'c': 'E4', 'v': 'F4', 'b': 'G4', 'n': 'A4', 'm': 'B4',
            ',': 'C5', '.': 'D5', '/': 'E5',

            // Number row for black keys in higher octave
            '1': 'C4', '2': 'D4', '3': 'E4', '4': 'F4', '5': 'G4', '6': 'A4', '7': 'B4',
            '8': 'C5', '9': 'D5', '0': 'E5', '-': 'F5', '=': 'G5',

            // Additional mappings for sharps
            'q': 'C#4', 'r': 'F#4', 'i': 'A#4',
            '[': 'F#4', ']': 'G#4'
        };

        this.init();
    }

    async init() {
        await this.audio.init();
        this.createPianoKeys();
        this.setupEventListeners();
        this.setupControls();
    }

    createPianoKeys() {
        const piano = document.getElementById('piano');
        piano.innerHTML = '';

        let whiteKeyIndex = 0;
        const whiteKeyWidth = 52; // Width including margin

        this.notes.forEach((note, index) => {
            const isBlack = note.includes('#');
            const key = document.createElement('div');
            key.className = `key ${isBlack ? 'black' : 'white'}`;
            key.dataset.note = note;

            // Find keyboard shortcut for this note
            const shortcut = Object.entries(this.keyboardMap).find(([k, n]) => n === note)?.[0];

            // Add label
            const label = document.createElement('span');
            label.className = 'key-label';
            label.textContent = shortcut ? shortcut.toUpperCase() : '';
            key.appendChild(label);

            if (isBlack) {
                // Position black keys
                const blackKeyOffset = whiteKeyWidth * whiteKeyIndex - 17;
                key.style.left = `${blackKeyOffset + 15}px`; // Account for padding
            } else {
                whiteKeyIndex++;
            }

            this.keys.set(note, key);
            piano.appendChild(key);
        });
    }

    setupEventListeners() {
        // Keyboard events
        document.addEventListener('keydown', (e) => {
            if (e.repeat) return;

            const note = this.keyboardMap[e.key.toLowerCase()];
            if (note && !this.pressedKeys.has(e.key.toLowerCase())) {
                e.preventDefault();
                this.pressedKeys.add(e.key.toLowerCase());
                this.playNote(note);
            }
        });

        document.addEventListener('keyup', (e) => {
            const note = this.keyboardMap[e.key.toLowerCase()];
            if (note) {
                this.pressedKeys.delete(e.key.toLowerCase());
                this.stopNote(note);
            }
        });

        // Mouse/touch events on keys
        this.keys.forEach((keyElement, note) => {
            keyElement.addEventListener('mousedown', (e) => {
                e.preventDefault();
                this.playNote(note);
            });

            keyElement.addEventListener('mouseup', () => {
                this.stopNote(note);
            });

            keyElement.addEventListener('mouseleave', () => {
                if (keyElement.classList.contains('active')) {
                    this.stopNote(note);
                }
            });

            // Touch support
            keyElement.addEventListener('touchstart', (e) => {
                e.preventDefault();
                this.playNote(note);
            });

            keyElement.addEventListener('touchend', () => {
                this.stopNote(note);
            });
        });

        // Prevent context menu on piano
        document.getElementById('piano').addEventListener('contextmenu', e => e.preventDefault());
    }

    setupControls() {
        // Volume control
        const volumeSlider = document.getElementById('volume');
        volumeSlider.addEventListener('input', (e) => {
            this.audio.setVolume(e.target.value / 100);
        });

        // Duet toggle
        const duetToggle = document.getElementById('duet-toggle');
        const duetIndicator = document.getElementById('duet-indicator');

        duetToggle.addEventListener('click', () => {
            this.duetMode = !this.duetMode;

            if (this.duetMode) {
                this.accompaniment.enable();
                duetToggle.classList.add('active');
                duetToggle.querySelector('.duet-text').textContent = 'Duet Mode: ON';
                duetIndicator.classList.remove('hidden');
            } else {
                this.accompaniment.disable();
                duetToggle.classList.remove('active');
                duetToggle.querySelector('.duet-text').textContent = 'Duet Mode: OFF';
                duetIndicator.classList.add('hidden');
            }
        });

        // Style selector
        const styleSelect = document.getElementById('style');
        styleSelect.addEventListener('change', (e) => {
            this.accompaniment.setStyle(e.target.value);
        });

        // Just intonation toggle
        const justToggle = document.getElementById('just-toggle');
        const tuningLabel = document.getElementById('tuning-label');
        const keySelect = document.getElementById('key');

        justToggle.addEventListener('click', () => {
            const isJust = justToggle.classList.toggle('active');
            this.audio.setTuning(isJust ? 'just' : 'equal');
            tuningLabel.textContent = isJust ? 'Just' : '12-TET';
            keySelect.classList.toggle('hidden', !isJust);
        });

        // Key selector
        keySelect.addEventListener('change', (e) => {
            this.audio.setKey(e.target.value);
        });
    }

    playNote(note) {
        const key = this.keys.get(note);
        if (key) {
            key.classList.add('active');
        }

        this.audio.playNote(note);

        // Trigger accompaniment if enabled
        if (this.duetMode) {
            this.accompaniment.playAccompaniment(note, (aiNote, active) => {
                this.highlightKey(aiNote, active, true);
            });
        }
    }

    stopNote(note) {
        const key = this.keys.get(note);
        if (key) {
            key.classList.remove('active');
        }

        this.audio.stopNote(note);
    }

    highlightKey(note, active, isAI = false) {
        const key = this.keys.get(note);
        if (key) {
            if (active) {
                key.classList.add('ai-active');
            } else {
                key.classList.remove('ai-active');
            }
        }
    }
}

// Initialize piano when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.piano = new Piano();
});

// Handle visibility change to stop all notes
document.addEventListener('visibilitychange', () => {
    if (document.hidden && window.piano) {
        window.piano.audio.stopAllNotes();
    }
});
