"""Private same-host renderer client; no listener, authentication or public route.

The caller MUST authenticate/limit its public request before invoking this helper.
No incoming headers or credentials are accepted/forwarded. Public integration
requires the canonical endpoint owner's review and coordination.
"""
import http.client
import io
import json
import math
import wave
from dataclasses import dataclass
from urllib.parse import urlencode

RENDERER_PORT = 9918
MAX_BYTES = 900_000


class RenderRejected(Exception):
    def __init__(self, status, message, retry_after=None):
        super().__init__(message)
        self.status = status
        self.retry_after = retry_after


class RenderProtocolError(Exception):
    """The owning endpoint should return a generic upstream failure (502)."""


@dataclass(frozen=True)
class RenderResult:
    wav: bytes
    key: int
    seconds: float


def _frames(data):
    try:
        with wave.open(io.BytesIO(data)) as w:
            if (w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getcomptype()) != (1, 2, 44100, 'NONE'):
                raise ValueError('Use mono PCM16 WAV at 44100 Hz.')
            n = w.getnframes()
            if not 22050 <= n <= 441000 or len(w.readframes(n)) != n * 2:
                raise ValueError('Take must contain 0.5–10 seconds of complete PCM.')
            return n
    except (wave.Error, EOFError) as e:
        raise ValueError('Invalid PCM WAV.') from e


def render_take(wav, key='auto', voices=2):
    """Bounded synchronous loopback call. No tokens/Origin/cookies forwarded.

    Owner must confirm its HTTPS proxy accepts >=130-second requests; otherwise
    use an owner-coordinated async job interface rather than this synchronous API.
    """
    if not isinstance(wav, bytes) or not 44 < len(wav) <= MAX_BYTES:
        raise RenderRejected(413, 'WAV size limit is 900000 bytes.')
    if isinstance(voices, bool) or voices not in (1, 2):
        raise RenderRejected(422, 'Invalid voice count.')
    if key != 'auto' and (isinstance(key, bool) or not isinstance(key, int) or key not in range(12)):
        raise RenderRejected(422, 'Invalid major key.')
    try:
        frames = _frames(wav)
    except ValueError as e:
        raise RenderRejected(422, str(e)) from e
    conn = http.client.HTTPConnection('127.0.0.1', RENDERER_PORT, timeout=125)
    try:
        conn.request('POST', '/take?' + urlencode({'key': key, 'voices': voices}),
                     wav, {'Content-Type': 'audio/wav'})
        response = conn.getresponse()
        if response.status != 200:
            body = response.read(4097)
            retry = response.getheader('Retry-After')
            retry = int(retry) if retry and retry.isdigit() and int(retry) <= 300 else None
            messages = {413: 'Take is too large.', 422: 'Take could not be rendered.',
                        429: 'Renderer rate limit reached.', 503: 'Renderer is busy.'}
            if response.status in messages:
                message = messages[response.status]
                if response.status == 422 and len(body) <= 4096:
                    try:
                        value = json.loads(body).get('error')
                        if isinstance(value, str):
                            message = value[:200]
                    except (ValueError, AttributeError):
                        pass
                raise RenderRejected(response.status, message, retry)
            raise RenderProtocolError('Private renderer returned an unexpected status.')
        result = response.read(MAX_BYTES + 1)
        if len(result) > MAX_BYTES or response.getheader('Content-Type', '').split(';')[0] != 'audio/wav':
            raise RenderProtocolError('Invalid private renderer response.')
        try:
            if _frames(result) != frames:
                raise ValueError('Duration changed')
            result_key = int(response.getheader('X-Harmony-Key', ''))
            seconds = float(response.getheader('X-Render-Seconds', ''))
            if result_key not in range(12) or not math.isfinite(seconds) or seconds < 0:
                raise ValueError('Invalid metadata')
        except (TypeError, ValueError) as e:
            raise RenderProtocolError('Invalid private renderer waveform or metadata.') from e
        return RenderResult(result, result_key, seconds)
    except (TimeoutError, OSError, http.client.HTTPException) as e:
        raise RenderProtocolError('Private renderer transport failed.') from e
    finally:
        conn.close()
