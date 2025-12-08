// AI Accompaniment System
class AccompanimentEngine {
    constructor(pianoAudio) {
        this.audio = pianoAudio;
        this.enabled = false;
        this.style = 'chords';
        this.recentNotes = [];
        this.maxHistory = 8;
        this.currentKey = 'C';
        this.currentScale = 'major';
        this.activeAccompanimentNotes = new Set();
        this.scheduledTimeouts = [];

        // Music theory data
        this.scales = {
            major: [0, 2, 4, 5, 7, 9, 11],
            minor: [0, 2, 3, 5, 7, 8, 10],
            dorian: [0, 2, 3, 5, 7, 9, 10],
            mixolydian: [0, 2, 4, 5, 7, 9, 10]
        };

        this.chordPatterns = {
            major: { intervals: [0, 4, 7], quality: 'major' },
            minor: { intervals: [0, 3, 7], quality: 'minor' },
            diminished: { intervals: [0, 3, 6], quality: 'dim' },
            augmented: { intervals: [0, 4, 8], quality: 'aug' },
            major7: { intervals: [0, 4, 7, 11], quality: 'maj7' },
            minor7: { intervals: [0, 3, 7, 10], quality: 'min7' },
            dominant7: { intervals: [0, 4, 7, 10], quality: '7' }
        };

        // Map scale degrees to chord types
        this.scaleChords = {
            major: ['major', 'minor', 'minor', 'major', 'major', 'minor', 'diminished'],
            minor: ['minor', 'diminished', 'major', 'minor', 'minor', 'major', 'major']
        };

        this.noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    }

    setStyle(style) {
        this.style = style;
    }

    enable() {
        this.enabled = true;
        this.recentNotes = [];
    }

    disable() {
        this.enabled = false;
        this.stopAllAccompaniment();
        this.recentNotes = [];
    }

    stopAllAccompaniment() {
        // Clear scheduled timeouts
        this.scheduledTimeouts.forEach(timeout => clearTimeout(timeout));
        this.scheduledTimeouts = [];

        // Stop all accompaniment notes
        this.activeAccompanimentNotes.forEach(note => {
            this.audio.stopNote(note, true);
        });
        this.activeAccompanimentNotes.clear();
    }

    // Parse note name to get note and octave
    parseNote(noteStr) {
        const match = noteStr.match(/^([A-G]#?)(\d)$/);
        if (!match) return null;
        return {
            note: match[1],
            octave: parseInt(match[2]),
            noteIndex: this.noteNames.indexOf(match[1])
        };
    }

    // Get note at interval from base
    getNoteAtInterval(baseNote, interval, octaveOffset = 0) {
        const newIndex = (baseNote.noteIndex + interval) % 12;
        const octaveChange = Math.floor((baseNote.noteIndex + interval) / 12);
        return this.noteNames[newIndex] + (baseNote.octave + octaveOffset + octaveChange);
    }

    // Detect the most likely key from recent notes
    detectKey(notes) {
        if (notes.length === 0) return { root: 'C', scale: 'major' };

        const noteIndices = notes.map(n => this.parseNote(n)?.noteIndex).filter(n => n !== undefined);

        let bestMatch = { root: 'C', scale: 'major', score: 0 };

        // Try each possible key
        for (let root = 0; root < 12; root++) {
            for (const [scaleName, scaleIntervals] of Object.entries(this.scales)) {
                const scaleNotes = scaleIntervals.map(i => (root + i) % 12);
                let score = 0;

                noteIndices.forEach(noteIndex => {
                    if (scaleNotes.includes(noteIndex)) {
                        score++;
                        // Bonus for root and fifth
                        if (noteIndex === root) score += 0.5;
                        if (noteIndex === (root + 7) % 12) score += 0.3;
                    }
                });

                if (score > bestMatch.score) {
                    bestMatch = { root: this.noteNames[root], scale: scaleName, score };
                }
            }
        }

        return bestMatch;
    }

    // Find a good chord based on the played note and detected key
    findChord(playedNote, key) {
        const parsed = this.parseNote(playedNote);
        if (!parsed) return null;

        const keyRootIndex = this.noteNames.indexOf(key.root);
        const scaleIntervals = this.scales[key.scale] || this.scales.major;
        const chordTypes = this.scaleChords[key.scale] || this.scaleChords.major;

        // Find which scale degree the played note is closest to
        const interval = (parsed.noteIndex - keyRootIndex + 12) % 12;
        let closestDegree = 0;
        let minDistance = 12;

        scaleIntervals.forEach((scaleInterval, degree) => {
            const distance = Math.abs(scaleInterval - interval);
            if (distance < minDistance) {
                minDistance = distance;
                closestDegree = degree;
            }
        });

        // Get the chord for this scale degree
        const chordRoot = (keyRootIndex + scaleIntervals[closestDegree]) % 12;
        const chordType = chordTypes[closestDegree];
        const chordPattern = this.chordPatterns[chordType];

        return {
            root: this.noteNames[chordRoot],
            rootIndex: chordRoot,
            type: chordType,
            intervals: chordPattern.intervals,
            baseOctave: Math.max(2, parsed.octave - 1)
        };
    }

    // Play accompaniment based on style
    playAccompaniment(playedNote, onKeyHighlight) {
        if (!this.enabled) return;

        // Add to history
        this.recentNotes.push(playedNote);
        if (this.recentNotes.length > this.maxHistory) {
            this.recentNotes.shift();
        }

        // Detect key from recent notes
        const key = this.detectKey(this.recentNotes);
        const chord = this.findChord(playedNote, key);

        if (!chord) return;

        // Stop previous accompaniment
        this.stopAllAccompaniment();

        // Play based on style
        switch (this.style) {
            case 'chords':
                this.playChordStyle(chord, onKeyHighlight);
                break;
            case 'arpeggios':
                this.playArpeggioStyle(chord, onKeyHighlight);
                break;
            case 'bass':
                this.playBassStyle(chord, onKeyHighlight);
                break;
            case 'counterpoint':
                this.playCounterpointStyle(chord, playedNote, key, onKeyHighlight);
                break;
        }
    }

    // Chord accompaniment - play block chords
    playChordStyle(chord, onKeyHighlight) {
        const baseOctave = chord.baseOctave;

        chord.intervals.forEach((interval, i) => {
            const noteIndex = (chord.rootIndex + interval) % 12;
            const octave = baseOctave + Math.floor((chord.rootIndex + interval) / 12);
            const note = this.noteNames[noteIndex] + octave;

            // Slight delay for natural feel
            const timeout = setTimeout(() => {
                this.audio.playNote(note, 0.4 + i * 0.05, true);
                this.activeAccompanimentNotes.add(note);
                if (onKeyHighlight) onKeyHighlight(note, true);

                // Stop after duration
                const stopTimeout = setTimeout(() => {
                    this.audio.stopNote(note, true);
                    this.activeAccompanimentNotes.delete(note);
                    if (onKeyHighlight) onKeyHighlight(note, false);
                }, 800);
                this.scheduledTimeouts.push(stopTimeout);
            }, i * 15);

            this.scheduledTimeouts.push(timeout);
        });
    }

    // Arpeggio accompaniment - play notes sequentially
    playArpeggioStyle(chord, onKeyHighlight) {
        const baseOctave = chord.baseOctave;
        const pattern = [0, 1, 2, 1]; // Up and back pattern

        pattern.forEach((intervalIndex, i) => {
            const interval = chord.intervals[intervalIndex % chord.intervals.length];
            const noteIndex = (chord.rootIndex + interval) % 12;
            const octave = baseOctave + Math.floor((chord.rootIndex + interval) / 12);
            const note = this.noteNames[noteIndex] + octave;

            const timeout = setTimeout(() => {
                this.audio.playNote(note, 0.35, true);
                this.activeAccompanimentNotes.add(note);
                if (onKeyHighlight) onKeyHighlight(note, true);

                const stopTimeout = setTimeout(() => {
                    this.audio.stopNote(note, true);
                    this.activeAccompanimentNotes.delete(note);
                    if (onKeyHighlight) onKeyHighlight(note, false);
                }, 200);
                this.scheduledTimeouts.push(stopTimeout);
            }, i * 120);

            this.scheduledTimeouts.push(timeout);
        });
    }

    // Bass line accompaniment
    playBassStyle(chord, onKeyHighlight) {
        const bassOctave = 2;
        const root = chord.root + bassOctave;
        const fifth = this.noteNames[(chord.rootIndex + 7) % 12] + bassOctave;

        // Root note
        this.audio.playNote(root, 0.5, true);
        this.activeAccompanimentNotes.add(root);
        if (onKeyHighlight) onKeyHighlight(root, true);

        const stopRoot = setTimeout(() => {
            this.audio.stopNote(root, true);
            this.activeAccompanimentNotes.delete(root);
            if (onKeyHighlight) onKeyHighlight(root, false);
        }, 300);
        this.scheduledTimeouts.push(stopRoot);

        // Fifth note after delay
        const playFifth = setTimeout(() => {
            this.audio.playNote(fifth, 0.4, true);
            this.activeAccompanimentNotes.add(fifth);
            if (onKeyHighlight) onKeyHighlight(fifth, true);

            const stopFifth = setTimeout(() => {
                this.audio.stopNote(fifth, true);
                this.activeAccompanimentNotes.delete(fifth);
                if (onKeyHighlight) onKeyHighlight(fifth, false);
            }, 250);
            this.scheduledTimeouts.push(stopFifth);
        }, 200);
        this.scheduledTimeouts.push(playFifth);
    }

    // Counterpoint - play a melodic response
    playCounterpointStyle(chord, playedNote, key, onKeyHighlight) {
        const parsed = this.parseNote(playedNote);
        if (!parsed) return;

        const keyRootIndex = this.noteNames.indexOf(key.root);
        const scale = this.scales[key.scale] || this.scales.major;

        // Create a simple countermelody
        // Move in contrary motion or parallel thirds/sixths
        const counterNotes = [];
        const directions = [-3, -5, 3, -2]; // Intervals to try

        directions.forEach((dir, i) => {
            // Find a note in the scale that's roughly at this interval
            let targetInterval = (parsed.noteIndex - keyRootIndex + dir + 24) % 12;

            // Find closest scale tone
            let closestScaleTone = scale[0];
            let minDist = 12;
            scale.forEach(scaleInt => {
                const dist = Math.min(
                    Math.abs(scaleInt - targetInterval),
                    12 - Math.abs(scaleInt - targetInterval)
                );
                if (dist < minDist) {
                    minDist = dist;
                    closestScaleTone = scaleInt;
                }
            });

            const noteIndex = (keyRootIndex + closestScaleTone) % 12;
            const octave = parsed.octave + (dir < 0 ? -1 : 0);
            counterNotes.push(this.noteNames[noteIndex] + Math.max(2, octave));
        });

        // Play countermelody
        counterNotes.slice(0, 3).forEach((note, i) => {
            const timeout = setTimeout(() => {
                this.audio.playNote(note, 0.3, true);
                this.activeAccompanimentNotes.add(note);
                if (onKeyHighlight) onKeyHighlight(note, true);

                const stopTimeout = setTimeout(() => {
                    this.audio.stopNote(note, true);
                    this.activeAccompanimentNotes.delete(note);
                    if (onKeyHighlight) onKeyHighlight(note, false);
                }, 250);
                this.scheduledTimeouts.push(stopTimeout);
            }, i * 150);

            this.scheduledTimeouts.push(timeout);
        });
    }
}

window.AccompanimentEngine = AccompanimentEngine;
