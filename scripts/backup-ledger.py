"""Create an integrity-checked SQLite backup without interrupting the server."""

import os
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

if len(sys.argv) != 3:
    raise SystemExit("Usage: backup-ledger.py DATABASE BACKUP_DIRECTORY")

database, directory = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
directory.mkdir(mode=0o700, parents=True, exist_ok=True)
timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
temporary = directory / f".{timestamp}.tmp"
destination = directory / f"promptplay-{timestamp}.sqlite"
try:
    with sqlite3.connect(f"file:{database}?mode=ro", uri=True) as source:
        with sqlite3.connect(temporary) as backup:
            os.chmod(temporary, 0o600)
            source.backup(backup)
            if backup.execute("PRAGMA integrity_check").fetchone() != ("ok",):
                raise RuntimeError("Backup integrity check failed")
    os.replace(temporary, destination)
    print(destination)
finally:
    temporary.unlink(missing_ok=True)
