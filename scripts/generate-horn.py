#!/usr/bin/env python3
"""Original deterministic dual-tone game horn; no sampled/third-party audio."""
from pathlib import Path
import math, struct, wave, hashlib

root=Path(__file__).resolve().parents[1]
rate=44100
# Integer-cycle harmonics make the one-second native loop continuous. A soft
# dual fundamental gives a recognisable car horn without copying a recording.
samples=[]
for frame in range(rate):
    t=frame/rate
    value=sum(weight*math.sin(2*math.pi*frequency*t)for frequency,weight in[(350,.31),(440,.28),(700,.09),(880,.07),(1050,.035),(1320,.025)])
    value*=.94+.06*math.cos(2*math.pi*3*t)
    samples.append(struct.pack('<h',round(max(-.82,min(.82,value))*32767)))
data=b''.join(samples)
paths=[root/'assets/sounds/harbour_horn.wav',root/'ios/app/sounds/harbour_horn.wav',root/'android/app/src/main/res/raw/harbour_horn.wav']
for path in paths:
    path.parent.mkdir(parents=True,exist_ok=True)
    with wave.open(str(path),'wb')as output:
        output.setnchannels(1);output.setsampwidth(2);output.setframerate(rate);output.writeframes(data)
assert len({hashlib.sha256(path.read_bytes()).hexdigest()for path in paths})==1
print('Generated original mono PCM horn in three native/source locations; SHA256',hashlib.sha256(paths[0].read_bytes()).hexdigest())
