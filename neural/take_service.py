"""Private, bounded offline neural take rendering. Audio never written to disk."""
import io
import json
import os
import threading
import time
import wave
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, parse_qs

import numpy as np
from dsp import SR, HOP, features, rms
from vocoder import NeuralVocoder, FrameControls

ROOT = Path(__file__).parent
MAX_BYTES = 900_000
GATE = threading.BoundedSemaphore(1)
MODEL = None


def decode(data):
    try:
        with wave.open(io.BytesIO(data)) as w:
            if w.getnchannels() != 1 or w.getsampwidth() != 2 or w.getframerate() != SR or w.getcomptype() != 'NONE':
                raise ValueError('Use mono 16-bit PCM WAV at 44100 Hz.')
            n = w.getnframes()
            if not SR // 2 <= n <= 10 * SR:
                raise ValueError('Take must be 0.5–10 seconds.')
            raw = w.readframes(n)
            if len(raw) != n * 2:
                raise ValueError('Truncated WAV.')
        x = np.frombuffer(raw, dtype='<i2').astype(np.float32) / 32768
        if rms(x) < 0.0003:
            raise ValueError('Take is too quiet. Sing closer to the microphone.')
        return x
    except (wave.Error, EOFError) as e:
        raise ValueError('Invalid PCM WAV.') from e


def estimate_key(f0):
    voiced = f0[f0 > 0]
    if len(voiced) < 5:
        raise ValueError('No stable sung pitch detected. Try a clear melody.')
    notes = 69 + 12 * np.log2(voiced / 440)
    hist = np.bincount(np.round(notes).astype(int) % 12, minlength=12)
    # Major-key profile; a short take is ambiguous, so the UI offers an override.
    profile = np.array([6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88])
    return int(np.argmax([np.dot(hist, np.roll(profile, k)) for k in range(12)]))


def render(data, key=None, voices=2):
    started = time.perf_counter()
    x = decode(data)
    _, f0 = features(x)
    key = estimate_key(f0) if key is None else key
    scale = np.array([key + 12 * o + s for o in range(-1, 12) for s in (0,2,4,5,7,9,11)])
    padded = np.pad(x, (0, (-len(x)) % HOP))
    # Bound inference working set to one second plus 100 ms context, stitch overlap.
    mix = x.astype(np.float64) * 0.65
    for degree in (2,4)[:voices]:
        def condition(positions, observed, default):
            notes = 69 + 12 * np.log2(np.maximum(observed, 1) / 440)
            idx = np.argmin(abs(notes[:,None] - scale), axis=1)
            delta = scale[np.minimum(idx+degree, len(scale)-1)] - scale[idx]
            target = np.where(observed > 0, observed * 2 ** (delta/12), 0)
            target = np.where((target >= 50) & (target <= 2500), target, 0)
            return FrameControls(target, (observed > 0).astype(np.float32))
        y = np.zeros(len(padded), dtype=np.float64)
        weight = np.zeros(len(padded))
        step, overlap = HOP * 80, HOP * 8
        for start in range(0, len(padded), step):
            lo, hi = max(0,start-overlap), min(len(padded),start+step+overlap)
            chunk = MODEL.synthesize(padded[lo:hi], conditioning=condition)
            chunk = np.pad(chunk,(0,max(0,hi-lo-len(chunk))))[:hi-lo]
            window = np.ones(hi-lo)
            if lo: window[:overlap] = np.linspace(0,1,overlap)
            if hi < len(padded): window[-overlap:] = np.linspace(1,0,overlap)
            y[lo:hi] += chunk * window
            weight[lo:hi] += window
        y = (y / np.maximum(weight, 1e-9))[:len(x)]
        mix += y * min(2, rms(x) / max(rms(y), 1e-6)) * 0.35
    mix *= min(1, 0.94 / max(np.max(abs(mix)), 1e-9))
    out = io.BytesIO()
    with wave.open(out, 'wb') as w:
        w.setparams((1,2,SR,0,'NONE','not compressed'))
        w.writeframes((mix * 32767).astype('<i2').tobytes())
    return out.getvalue(), key, time.perf_counter()-started


class Limiter:
    def __init__(self):
        self.times = deque()
        self.lock = threading.Lock()
    def allow(self):
        with self.lock:
            now = time.monotonic()
            while self.times and now-self.times[0] > 60: self.times.popleft()
            if len(self.times) >= 4: return False
            self.times.append(now)
            return True


class Handler(BaseHTTPRequestHandler):
    limiter = Limiter()  # global: forwarded headers cannot bypass the CPU budget
    def setup(self):
        super().setup()
        self.connection.settimeout(20)
    def log_message(self, fmt, *args):
        pass  # no audio, URLs, or client identity logs
    def send(self, status, body, mime='application/json', extra=None):
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length',str(len(body)))
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Connection','close')
        for k,v in (extra or {}).items(): self.send_header(k,str(v))
        self.end_headers()
        self.wfile.write(body)
    def error(self, status, message):
        self.send(status,json.dumps({'error':message}).encode())
    def do_GET(self):
        path = urlsplit(self.path).path
        assets = {'/':'index.html','/take.js':'take.js','/capture.js':'capture.js'}
        if path == '/health':
            return self.send(200,b'{"ready":true,"sample_rate":44100,"max_seconds":10}')
        if path not in assets: return self.error(404,'Not found')
        p = ROOT/'take-web'/assets[path]
        self.send(200,p.read_bytes(),'text/html; charset=utf-8' if path=='/' else 'text/javascript')
    def do_POST(self):
        url = urlsplit(self.path)
        if url.path != '/take': return self.error(404,'Not found')
        origin = self.headers.get('Origin')
        allowed = os.environ.get('TAKE_ORIGIN','https://jacob-dev-1.tailb2a35c.ts.net:9918')
        if origin and origin not in (allowed, 'http://127.0.0.1:9918', 'http://jacob-dev-1.tailb2a35c.ts.net:9918', 'http://100.116.136.69:9918'): return self.error(403,'Origin not allowed')
        if self.headers.get('Transfer-Encoding'): return self.error(400,'Content-Length required')
        try: length = int(self.headers.get('Content-Length','0'))
        except ValueError: return self.error(400,'Invalid length')
        if not 44 < length <= MAX_BYTES: return self.error(413,'WAV size limit is 900000 bytes')
        if not self.limiter.allow(): return self.send(429,b'{"error":"Four takes per minute. Try again shortly."}',extra={'Retry-After':60})
        if not GATE.acquire(blocking=False): return self.error(503,'Renderer busy. Try again shortly.')
        acquired = True
        try:
            args = parse_qs(url.query)
            key = None if args.get('key',['auto'])[0]=='auto' else int(args['key'][0])
            voices = int(args.get('voices',['2'])[0])
            if key is not None and key not in range(12) or voices not in (1,2): raise ValueError('Invalid key or voices')
            data = self.rfile.read(length)
            if len(data) != length: raise ValueError('Truncated upload')
            wav,key,seconds = render(data,key,voices)
            GATE.release()
            acquired = False
            self.send(200,wav,'audio/wav',{'X-Harmony-Key':key,'X-Render-Seconds':round(seconds,3),'Content-Disposition':'attachment; filename="neural-harmony.wav"'})
        except ValueError as e:
            GATE.release()
            acquired = False
            self.error(422,str(e))
        except (TimeoutError, ConnectionError): pass
        except Exception: self.error(500,'Neural render failed. Please retry.')
        finally:
            if acquired: GATE.release()


if __name__ == '__main__':
    MODEL = NeuralVocoder(threads=2)
    MODEL.synthesize(np.zeros(HOP*8,dtype=np.float32))
    port = int(os.environ.get('PORT','9918'))
    # Only explicit loopback/tailnet bindings, never wildcard/public interfaces.
    private = os.environ.get('TAILNET_BIND')
    if private:
        import ipaddress
        if ipaddress.ip_address(private) not in ipaddress.ip_network('100.64.0.0/10'):
            raise ValueError('TAILNET_BIND must be a tailnet IPv4 address')
        server = ThreadingHTTPServer((private,port),Handler)
        threading.Thread(target=server.serve_forever,daemon=True).start()
    ThreadingHTTPServer(('127.0.0.1',port),Handler).serve_forever()
