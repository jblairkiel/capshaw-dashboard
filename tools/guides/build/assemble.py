"""Title card, the recorded segments in order, closing card — one MP4.

    python3 build/assemble.py <plan.json>

The plan (written by run.js) names the segment clips, the card images, and
optionally an exact total length. To hit that length the recorded footage is
played slightly faster (never slower) and the closing card takes up whatever
is left; if that needs more than a small speed-up, the scenes are too long
and it says so rather than producing something that looks rushed.
"""
import json, subprocess, sys
import imageio_ffmpeg

plan = json.load(open(sys.argv[1]))
ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
def probe(path):
    info = subprocess.run([ffmpeg, '-i', path], capture_output=True, text=True).stderr
    h, m, s = info.split('Duration: ')[1].split(',')[0].split(':')
    return int(h) * 3600 + int(m) * 60 + float(s)


clips = plan['segments']
raw = sum(probe(c) for c in clips)
title = plan['titleSeconds'] if plan.get('titleCard') else 0.0
end_min = plan['endSeconds'] if plan.get('endCard') else 0.0
total = plan.get('total')

if total:
    speed = max(1.0, raw / (total - title - end_min))
    if speed > 1.12:
        sys.exit(f'The scenes run {raw:.0f}s, too long for a {total:.0f}s guide even sped up 12% — '
                 f'trim a scene or pass a lower --pace.')
    end = total - title - raw / speed
    if end > 15:
        print(f'  note: the scenes are short, so the closing card fills {end:.0f}s')
else:
    speed, end = 1.0, end_min
    total = title + raw + end

fade = 0.35
inputs, parts, labels = [], [], []
n = 0
if title:
    inputs += ['-loop', '1', '-framerate', '30', '-t', f'{title}', '-i', plan['titleCard']]
    parts.append(f'[{n}:v]fps=30,format=yuv420p,fade=t=in:st=0:d=0.8,fade=t=out:st={title - 0.45}:d=0.45[v{n}]')
    labels.append(f'[v{n}]'); n += 1
for clip in clips:
    d = probe(clip) / speed
    inputs += ['-i', clip]
    parts.append(f'[{n}:v]setpts=PTS/{speed:.6f},fps=30,trim=duration={d:.4f},setpts=PTS-STARTPTS,format=yuv420p,'
                 f'fade=t=in:st=0:d={fade},fade=t=out:st={d - fade:.4f}:d={fade}[v{n}]')
    labels.append(f'[v{n}]'); n += 1
if end:
    inputs += ['-loop', '1', '-framerate', '30', '-t', f'{end + 0.5:.4f}', '-i', plan['endCard']]
    parts.append(f'[{n}:v]fps=30,format=yuv420p,trim=duration={end:.4f},fade=t=in:st=0:d=0.6,fade=t=out:st={end - 1.2:.4f}:d=1.2[v{n}]')
    labels.append(f'[v{n}]'); n += 1
parts.append(f"{''.join(labels)}concat=n={len(labels)}:v=1:a=0[v]")
# A silent track: some players and upload sites handle a video without one badly.
inputs += ['-f', 'lavfi', '-t', f'{total}', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000']

subprocess.run([ffmpeg, '-loglevel', 'error', '-y', *inputs, '-filter_complex', ';'.join(parts),
                '-map', '[v]', '-map', f'{n}:a', '-t', f'{total}', '-r', '30',
                '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p',
                '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', plan['out']], check=True)
print(f"  {plan['out']}: {total:.1f}s (footage x{speed:.3f}, closing card {end:.1f}s)")
