#!/usr/bin/env python3
"""Copy original XCTest PNG attachments, including an unfinished result bundle.

The normal xcresulttool exporter needs a finalized Info.plist. Xcode 27.1 can
stall finalizing this local runtime, so the fallback reads attachment references
from its own Zstandard metadata and copies the PNG payloads without alteration.
"""
from pathlib import Path
import re
import shutil
import subprocess
import sys

result = Path(sys.argv[1])
output = Path(sys.argv[2])
output.mkdir(parents=True, exist_ok=True)
pattern = re.compile(r"K4:name\[S6:StringK2:_vV\d+:(\d{2}-[A-Za-z-]+)\]K10:payloadRef\[S9:ReferenceK2:id\[S6:StringK2:_vV\d+:(0~[A-Za-z0-9_=-]+)")
copied = set()
for blob in (result / "Data").glob("data.*"):
    if blob.read_bytes()[:4] != bytes.fromhex("28b52ffd"):
        continue
    decoded = subprocess.run(["zstd", "-d", "-c", str(blob)], capture_output=True, check=True).stdout.decode("utf-8", "replace")
    for name, reference in pattern.findall(decoded):
        payload = result / "Data" / f"data.{reference}"
        if payload.exists() and payload.read_bytes().startswith(b"\x89PNG\r\n\x1a\n"):
            shutil.copyfile(payload, output / f"{name}.png")
            copied.add(name)
print("\n".join(str(output / f"{name}.png") for name in sorted(copied)))
