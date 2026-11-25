"""Wait until the Local AI Studio backend answers, then open it in a browser.

Used by start.bat; can also be run manually:
    python scripts/wait_and_open.py http://127.0.0.1:8000
"""

from __future__ import annotations

import sys
import time
import urllib.error
import urllib.request
import webbrowser

TIMEOUT_SECONDS = 60


def main() -> int:
    base_url = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000").rstrip("/")
    deadline = time.monotonic() + TIMEOUT_SECONDS

    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(f"{base_url}/health", timeout=1) as response:
                if response.status == 200:
                    webbrowser.open(base_url)
                    print(f"[ok] backend is up - opened {base_url} in the default browser")
                    return 0
        except (urllib.error.URLError, OSError):
            time.sleep(1)

    print(f"[warn] backend did not answer within {TIMEOUT_SECONDS}s - open {base_url} manually")
    return 1


if __name__ == "__main__":
    sys.exit(main())
