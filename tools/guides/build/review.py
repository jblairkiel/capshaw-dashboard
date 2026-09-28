"""Contact sheets of a finished video, four frames to a sheet, for checking a
guide without watching all of it — captions, callouts and cursor included.

    python3 build/review.py <video> <out dir> [frame count, default 16]
"""
import os, subprocess, sys
import imageio_ffmpeg
from PIL import Image, ImageDraw

video, out = sys.argv[1], sys.argv[2]
count = int(sys.argv[3]) if len(sys.argv) > 3 else 16
ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
os.makedirs(out, exist_ok=True)

info = subprocess.run([ffmpeg, '-i', video], capture_output=True, text=True).stderr
h, m, s = info.split('Duration: ')[1].split(',')[0].split(':')
length = int(h) * 3600 + int(m) * 60 + float(s)
times = [length * (i + 0.5) / count for i in range(count)]

frames = []
for t in times:
    path = os.path.join(out, f'frame-{t:07.2f}.png')
    subprocess.run([ffmpeg, '-loglevel', 'error', '-y', '-ss', f'{t:.2f}', '-i', video, '-frames:v', '1', path], check=True)
    frames.append((t, path))

for k in range(0, len(frames), 4):
    sheet = Image.new('RGB', (1920 * 2 + 20, 1080 * 2 + 20), 'black')
    for i, (t, path) in enumerate(frames[k:k + 4]):
        tile = Image.open(path).convert('RGB')
        ImageDraw.Draw(tile).rectangle([0, 0, 150, 52], fill='black')
        ImageDraw.Draw(tile).text((14, 12), f'{int(t // 60)}:{t % 60:05.2f}', fill='white', font_size=28)
        sheet.paste(tile, ((i % 2) * 1940, (i // 2) * 1100))
    sheet.resize((1600, 900)).save(os.path.join(out, f'sheet-{k // 4 + 1}.png'))
print(f'  review sheets in {out}')
