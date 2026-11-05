"""Local review launcher. No persistent service and no automatic audio playback."""

import random
import threading
import webbrowser
import socketserver
from serve import Handler


def main():
    for _ in range(100):
        port = random.randint(7000, 9999)
        try:
            server = socketserver.ThreadingTCPServer(("127.0.0.1", port), Handler)
            break
        except OSError:
            continue
    else:
        raise RuntimeError("No free review port")
    try:
        threading.Timer(
            0.5, lambda: webbrowser.open(f"http://127.0.0.1:{port}/")
        ).start()
        print(
            f"Local review opened on port {port}. Ctrl-C stops the server. Audio remains paused."
        )
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
