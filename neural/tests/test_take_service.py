import io
import sys
import unittest
import wave
from pathlib import Path
import threading
import http.client
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import take_service as s
from vocoder import NeuralVocoder


def fixture(seconds=1):
    t=np.arange(int(s.SR*seconds))/s.SR
    x=(.12*np.sin(2*np.pi*220*t)+.05*np.sin(2*np.pi*440*t))
    b=io.BytesIO()
    with wave.open(b,'wb') as w:
        w.setparams((1,2,s.SR,0,'NONE',''))
        w.writeframes((x*32767).astype('<i2').tobytes())
    return b.getvalue()


class TakeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        s.MODEL=NeuralVocoder()
        cls.server=s.ThreadingHTTPServer(('127.0.0.1',0),s.Handler)
        threading.Thread(target=cls.server.serve_forever,daemon=True).start()
    @classmethod
    def tearDownClass(cls): cls.server.shutdown();cls.server.server_close()
    def request(self,data,path='/take',headers=None):
        c=http.client.HTTPConnection('127.0.0.1',self.server.server_port)
        c.request('POST',path,data,headers or {})
        r=c.getresponse();result=(r.status,r.read(),dict(r.getheaders()));c.close();return result
    def setUp(self): s.Handler.limiter=s.Limiter()
    def test_real_render_shape_rate_nonsilent(self):
        data=fixture()
        out,key,elapsed=s.render(data)
        with wave.open(io.BytesIO(out)) as w:
            self.assertEqual((w.getnchannels(),w.getsampwidth(),w.getframerate(),w.getnframes()),(1,2,44100,44100))
            y=np.frombuffer(w.readframes(w.getnframes()),dtype='<i2')/32768
        self.assertTrue(np.isfinite(y).all());self.assertGreater(s.rms(y),.01)
        self.assertLessEqual(np.max(abs(y)),.941)
        self.assertGreater(s.rms(y-.65*s.decode(data)),.005) # neural contribution, not just dry
    def test_http_output(self):
        status,body,headers=self.request(fixture(.5))
        self.assertEqual(status,200);self.assertTrue(body.startswith(b'RIFF'))
        self.assertEqual(headers['Content-Type'],'audio/wav')
    def test_reject_bad_shapes_rates_silence(self):
        for rate,channels,width,frames in [(48000,1,2,48000),(44100,2,2,44100),(44100,1,1,44100),(44100,1,2,441001),(44100,1,2,100)]:
            b=io.BytesIO()
            with wave.open(b,'wb') as w:
                w.setparams((channels,width,rate,0,'NONE',''));w.writeframes(bytes(frames*channels*width))
            with self.assertRaises(ValueError):s.decode(b.getvalue())
        with self.assertRaises(ValueError):s.decode(b'invalid')
    def test_rate_limit(self):
        for _ in range(4):self.assertEqual(self.request(b'x'*45)[0],422)
        status,_,h=self.request(b'x'*45)
        self.assertEqual(status,429);self.assertEqual(h['Retry-After'],'60')
    def test_caps_origin_and_busy(self):
        self.assertEqual(self.request(b'x'*900001)[0],413)
        self.assertEqual(self.request(fixture(),headers={'Origin':'https://evil.example'})[0],403)
        self.assertEqual(self.request(fixture(),'/take?key=12')[0],422)
        s.GATE.acquire()
        try:self.assertEqual(self.request(fixture())[0],503)
        finally:s.GATE.release()

if __name__=='__main__':unittest.main()
