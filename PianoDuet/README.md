# Piano Duet

A digital piano you can play with your computer keyboard, featuring an AI accompaniment mode that plays harmonic responses to your melodies in real-time.

## Running

Start a local server:

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080 in your browser.

## Keyboard Controls

### White Keys
- **Lower octave**: A S D F G H J K (C3 to B3)
- **Middle octave**: K L ; ' (C4 onwards)
- **Also**: Z X C V B N M , . / for a simple C major scale

### Black Keys
- W E T Y U O P for sharps/flats
- Q R I for additional sharps

### Number Row
- 1-0 and - = for the upper octave

## Duet Mode

Click the "Duet Mode" button to enable AI accompaniment. The AI listens to what you play and responds with musical accompaniment based on the detected key and scale.

### Accompaniment Styles

- **Chords**: Block chords that harmonize with your melody
- **Arpeggios**: Broken chord patterns that flow with your playing
- **Bass Line**: Root and fifth bass patterns
- **Counterpoint**: Melodic responses that move in contrary motion

## Features

- 3 octaves of piano keys (C3 to B5)
- Realistic piano sound using Web Audio API synthesis
- Real-time key detection and harmonic analysis
- Visual feedback showing both your notes and AI accompaniment
- Volume control
- Touch support for mobile/tablet
