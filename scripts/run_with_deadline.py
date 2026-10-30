#!/usr/bin/env python3
"""Bound build time to the Free-tier budget without leaving child processes."""
import os
import signal
import subprocess
import sys
from pathlib import Path

if len(sys.argv) != 3:
    raise SystemExit("Usage: run_with_deadline.py <max-seconds> <script>")
seconds = int(sys.argv[1])
if not 0 < seconds <= 2100:
    raise SystemExit("Maximum 2100 seconds")
script = Path(sys.argv[2])
if not script.is_file():
    raise SystemExit("Script missing")
proc = subprocess.Popen(["/bin/bash", str(script)], start_new_session=True)
try:
    code = proc.wait(timeout=seconds)
except subprocess.TimeoutExpired:
    print(f"MACOS_FREE_CREDIT_TIME_CAP: {seconds}s reached; terminating run", flush=True)
    os.killpg(proc.pid, signal.SIGTERM)
    try:
        proc.wait(timeout=12)
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGKILL)
        proc.wait(timeout=12)
    code = 124
sys.exit(code)
