"""Rebuilds one recorded segment as a steady 30fps clip.

Chrome only sends a frame when something on screen changes, each stamped with
wall-clock time. Every frame is held until the next one arrived, from the
segment's 'start' mark to its 'end' mark, so the clip runs in real time.

    python3 build/segment.py <work dir> <segment name>   ->  <work dir>/rec/<name>.mp4
"""
import json, os, subprocess, sys
import imageio_ffmpeg

work, name = sys.argv[1], sys.argv[2]
ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
frames = sorted(json.load(open(os.path.join(work, 'rec', name, 'frames.json'))), key=lambda f: f['ts'])
marks = {m['label']: m['epoch'] for m in json.load(open(os.path.join(work, 'marks.json')))[name]}
start, end = marks['start'], marks['end']

# The frame on screen at `start` is the last one painted at or before it.
first = max((i for i, f in enumerate(frames) if f['ts'] <= start), default=0)
chosen = [f for f in frames[first:] if f['ts'] < end]

lines = ['ffconcat version 1.0']
for i, f in enumerate(chosen):
    shown_from = max(f['ts'], start)
    shown_until = chosen[i + 1]['ts'] if i + 1 < len(chosen) else end
    lines += [f"file '{f['file']}'", f'duration {max(shown_until - shown_from, 0.001):.4f}']
lines.append(f"file '{chosen[-1]['file']}'")  # the concat demuxer ignores the last duration otherwise
listing = os.path.join(work, 'rec', name, 'frames.ffconcat')
open(listing, 'w').write('\n'.join(lines) + '\n')

out = os.path.join(work, 'rec', f'{name}.mp4')
subprocess.run([ffmpeg, '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listing,
                '-vf', 'scale=1920:1080:flags=lanczos,fps=30,format=yuv420p', '-t', f'{end - start:.3f}',
                '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', out], check=True)
print(f'  {name}: {end - start:.1f}s from {len(chosen)} frames')
