"""Protocol boundary tests; the real ONNX renderer has separate service tests."""
import io
import sys
import threading
import unittest
import wave
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import route_b_bridge as bridge


def wav(rate=44100, frames=22050):
    b = io.BytesIO()
    with wave.open(b, 'wb') as w:
        w.setparams((1, 2, rate, 0, 'NONE', ''))
        w.writeframes(b'\x20\x00' * frames)
    return b.getvalue()


class Handler(BaseHTTPRequestHandler):
    status = 200
    result = wav()
    key = '5'
    seconds = '1.2'
    received = None
    def log_message(self, *args): pass
    def do_POST(self):
        type(self).received = (self.path, dict(self.headers), self.rfile.read(int(self.headers['Content-Length'])))
        self.send_response(self.status)
        self.send_header('Content-Type', 'audio/wav')
        self.send_header('X-Harmony-Key', self.key)
        self.send_header('X-Render-Seconds', self.seconds)
        self.send_header('Retry-After', '60')
        self.send_header('Content-Length', str(len(self.result)))
        self.end_headers()
        self.wfile.write(self.result)


class BridgeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.port = patch.object(bridge, 'RENDERER_PORT', cls.server.server_port)
        cls.port.start()
    @classmethod
    def tearDownClass(cls):
        cls.port.stop(); cls.server.shutdown(); cls.server.server_close()
    def setUp(self):
        Handler.status = 200; Handler.result = wav(); Handler.key = '5'; Handler.seconds = '1.2'; Handler.received = None
    def test_loopback_wire_and_result(self):
        data = wav(); result = bridge.render_take(data)
        path, headers, body = Handler.received
        self.assertEqual(path, '/take?key=auto&voices=2')
        self.assertEqual(body, data)
        self.assertFalse({'Origin', 'Authorization', 'Cookie'} & headers.keys())
        self.assertEqual((result.wav, result.key, result.seconds), (data, 5, 1.2))
    def test_input_rejected_before_network(self):
        for data, key, voices, status in [(b'x' * 900001, 'auto', 2, 413), (wav(48000), 'auto', 2, 422), (wav(), 12, 2, 422), (wav(), 'auto', True, 422)]:
            with self.assertRaises(bridge.RenderRejected) as c:
                bridge.render_take(data, key, voices)
            self.assertEqual(c.exception.status, status)
        self.assertIsNone(Handler.received)
    def test_rate_and_busy_preserved(self):
        for status in (429, 503):
            Handler.status = status
            with self.assertRaises(bridge.RenderRejected) as c: bridge.render_take(wav())
            self.assertEqual((c.exception.status, c.exception.retry_after), (status, 60))
    def test_rejects_bad_waveform_duration_and_metadata(self):
        for result, key, seconds in [(wav(48000), '5', '1'), (wav(frames=23000), '5', '1'), (wav(), '99', '1'), (wav(), '5', 'nan'), (b'x' * 900001, '5', '1')]:
            Handler.result, Handler.key, Handler.seconds = result, key, seconds
            with self.assertRaises(bridge.RenderProtocolError): bridge.render_take(wav())

if __name__ == '__main__': unittest.main()
