import time
import sys
import numpy as np
import sounddevice as sd
from pedalboard import Pedalboard, PitchShift, Reverb, Chorus, Gain, HighpassFilter, Compressor
from rich.live import Live
from rich.panel import Panel
from rich.layout import Layout
from rich.console import Console
from rich.text import Text
from rich.progress import BarColumn, Progress, TextColumn
from pynput import keyboard

# --- Configuration ---
SAMPLE_RATE = 44100
BLOCK_SIZE = 512  # Smaller = lower latency, higher CPU
LATENCY = 'low'   # 'low' is aggressive, use 'high' if glitchy

# --- Audio Engine ---
class HarmonyEngine:
    def __init__(self):
        self.running = True
        self.active = False
        self.current_preset_index = 0
        self.input_level = 0.0
        self.output_level = 0.0
        
        # Dry signal processing (Compressor to even out levels)
        self.dry_board = Pedalboard([
            HighpassFilter(cutoff_frequency_hz=80), # Remove rumble
            Compressor(threshold_db=-20, ratio=2.5)
        ])
        
        # Harmony Voices (Persistent boards to keep state)
        # We'll create a few standard "Singers"
        self.singer_low = Pedalboard([
            PitchShift(semitones=-5),
            Gain(gain_db=-3),
            Chorus(rate_hz=1.0, depth=0.2, mix=0.3) # Humanize
        ])
        
        self.singer_high = Pedalboard([
            PitchShift(semitones=4), # Major 3rd approx
            Gain(gain_db=-3),
            Chorus(rate_hz=1.5, depth=0.2, mix=0.3)
        ])
        
        self.singer_octave = Pedalboard([
            PitchShift(semitones=7), # Perfect 5th
            Gain(gain_db=-4),
        ])
        
        # Global FX (Glue it together)
        self.master_fx = Pedalboard([
            Reverb(room_size=0.4, wet_level=0.3, dry_level=1.0)
        ])

        self.presets = [
            {"name": "Gospel Trio", "voices": ["low", "high"]},
            {"name": "Power Chord", "voices": ["low", "octave"]},
            {"name": "Angelic", "voices": ["high", "octave"]},
            {"name": "Demon", "voices": ["low"]},
            {"name": "Solo (Dry Only)", "voices": []}
        ]
        
    def callback(self, indata, outdata, frames, time, status):
        """Real-time audio processing callback."""
        if status:
            print(status, file=sys.stderr)
        
        # 1. Measure Input Level (RMS) for UI
        rms = np.sqrt(np.mean(indata**2))
        self.input_level = rms

        if not self.running:
            outdata[:] = np.zeros_like(outdata)
            return

        # 2. Process Audio
        # Convert to float32 standard (sounddevice does this, but good to ensure)
        audio_in = indata.astype(np.float32)
        
        # Upmix Mono Mic to Stereo for processing
        if audio_in.shape[1] == 1:
            audio_in = np.tile(audio_in, (1, 2))
        
        # Always process dry signal
        dry = self.dry_board(audio_in, SAMPLE_RATE, reset=False)
        
        mixed_signal = dry
        
        if self.active:
            current_voices = self.presets[self.current_preset_index]["voices"]
            
            # Generate harmonies
            # Note: We sum them into the mix
            if "low" in current_voices:
                mixed_signal += self.singer_low(dry, SAMPLE_RATE, reset=False)
            if "high" in current_voices:
                mixed_signal += self.singer_high(dry, SAMPLE_RATE, reset=False)
            if "octave" in current_voices:
                mixed_signal += self.singer_octave(dry, SAMPLE_RATE, reset=False)
        
        # Master FX
        final_output = self.master_fx(mixed_signal, SAMPLE_RATE, reset=False)
        
        # Limiter protection (clipping is bad)
        np.clip(final_output, -1.0, 1.0, out=final_output)
        
        # Measure Output Level
        self.output_level = np.sqrt(np.mean(final_output**2))

        # Write to output
        outdata[:] = final_output

    def toggle_active(self):
        self.active = not self.active

    def next_preset(self):
        self.current_preset_index = (self.current_preset_index + 1) % len(self.presets)

    def prev_preset(self):
        self.current_preset_index = (self.current_preset_index - 1) % len(self.presets)


# --- UI & Interaction ---
def run_app():
    engine = HarmonyEngine()
    console = Console()

    # Setup Keyboard Listener (Non-blocking)
    def on_press(key):
        try:
            if key == keyboard.Key.space:
                engine.toggle_active()
            elif key == keyboard.Key.right:
                engine.next_preset()
            elif key == keyboard.Key.left:
                engine.prev_preset()
            elif key == keyboard.Key.esc:
                engine.running = False
                return False # Stop listener
        except AttributeError:
            pass

    listener = keyboard.Listener(on_press=on_press)
    listener.start()

        # Audio Stream
    try:
        # Default to system defaults, but handle mono mic -> stereo speakers
        stream = sd.Stream(
            channels=(1, 2), # 1 Input (Mono Mic), 2 Output (Stereo Speakers)
            samplerate=SAMPLE_RATE,
            blocksize=BLOCK_SIZE,
            latency=LATENCY,
            callback=engine.callback
        )
        
        with stream:
            with Live(refresh_per_second=20, screen=True) as live:
                while engine.running:
                    # Construct UI
                    
                    # Status Color
                    status_color = "green" if engine.active else "dim white"
                    status_text = "ON AIR" if engine.active else "BYPASS"
                    
                    # Level Meters
                    in_meter_chars = "█" * int(engine.input_level * 50)
                    out_meter_chars = "█" * int(engine.output_level * 50)
                    
                    preset_name = engine.presets[engine.current_preset_index]["name"]
                    
                    panel_content = f"""
[bold {status_color}]STATUS: {status_text}[/]

[bold cyan]Preset:[/] {preset_name}

[bold yellow]Input: [/] {in_meter_chars}
[bold green]Mix:   [/] {out_meter_chars}

[dim]Controls:[/dim]
[Space] Toggle Harmony
[←/→]   Change Preset
[Esc]   Quit
"""
                    live.update(Panel(panel_content, title="🎤 Harmony CLI", border_style="blue"))
                    time.sleep(0.05)
                    
    except Exception as e:
        console.print(f"[bold red]Audio Error:[/bold red] {e}")
        console.print("[yellow]Tip: Make sure you have an input (mic) and output (speakers/headphones) available.[/yellow]")
    finally:
        listener.stop()

if __name__ == "__main__":
    run_app()
