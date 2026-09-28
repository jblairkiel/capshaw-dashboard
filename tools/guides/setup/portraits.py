"""Cartoon portraits for the sample directory, so Member Match and the
directory cards have faces to show without a single real photo.

One picture per household: a family photo when there are several people at
the address, which is also how the real directory stores family portraits
(several rows pointing at one file). Run by run.js after setup/index.js:

    python3 setup/portraits.py <work dir>
"""
import hashlib, os, random, sqlite3, sys
from PIL import Image, ImageDraw

work = sys.argv[1]
data = os.path.join(work, 'data')
photos = os.path.join(data, 'photos')
os.makedirs(photos, exist_ok=True)

SKIN = [(255, 224, 189), (241, 194, 125), (224, 172, 105), (198, 134, 66), (141, 85, 36), (255, 219, 172)]
HAIR = [(40, 30, 20), (90, 56, 37), (180, 140, 70), (230, 200, 120), (120, 120, 120), (160, 60, 30), (20, 20, 20)]
SHIRT = [(56, 95, 153), (170, 60, 60), (60, 130, 90), (200, 150, 50), (110, 80, 150), (40, 120, 140), (220, 110, 60)]
BACKDROP = [((236, 228, 210), (214, 196, 160)), ((210, 225, 240), (170, 195, 225)),
            ((225, 240, 220), (185, 215, 180)), ((245, 225, 225), (225, 185, 185))]


def backdrop(w, h, top, bottom):
    im = Image.new('RGB', (w, h))
    d = ImageDraw.Draw(im)
    for y in range(h):
        t = y / h
        d.line([(0, y), (w, y)], fill=tuple(int(top[i] * (1 - t) + bottom[i] * t) for i in range(3)))
    return im


def face(d, cx, cy, s, r, female, child):
    skin, hair, shirt = r.choice(SKIN), r.choice(HAIR), r.choice(SHIRT)
    if child:
        s *= 0.78
        cy += s * 0.35
    darker = lambda c, n: tuple(max(0, v - n) for v in c)
    d.ellipse([cx - 1.25 * s, cy + 0.85 * s, cx + 1.25 * s, cy + 2.9 * s], fill=shirt)
    d.rectangle([cx - 0.25 * s, cy + 0.6 * s, cx + 0.25 * s, cy + 1.0 * s], fill=skin)
    if female:
        d.rounded_rectangle([cx - 0.95 * s, cy - 0.9 * s, cx + 0.95 * s, cy + 1.05 * s], radius=int(0.5 * s), fill=hair)
    d.ellipse([cx - 0.8 * s, cy - 0.95 * s, cx + 0.8 * s, cy + 0.85 * s], fill=skin)
    d.chord([cx - 0.85 * s, cy - 1.1 * s, cx + 0.85 * s, cy + 0.35 * s], 180, 360, fill=hair)
    d.ellipse([cx - 0.9 * s, cy - 0.1 * s, cx - 0.68 * s, cy + 0.25 * s], fill=skin)
    d.ellipse([cx + 0.68 * s, cy - 0.1 * s, cx + 0.9 * s, cy + 0.25 * s], fill=skin)
    for ex in (-0.3, 0.3):
        d.ellipse([cx + ex * s - 0.1 * s, cy - 0.02 * s, cx + ex * s + 0.1 * s, cy + 0.18 * s], fill=(255, 255, 255))
        d.ellipse([cx + ex * s - 0.055 * s, cy + 0.03 * s, cx + ex * s + 0.055 * s, cy + 0.14 * s], fill=(40, 40, 50))
        d.line([cx + ex * s - 0.14 * s, cy - 0.12 * s, cx + ex * s + 0.14 * s, cy - 0.14 * s], fill=darker(hair, 30), width=max(2, int(0.05 * s)))
    if r.random() < 0.3 and not child:
        for ex in (-0.3, 0.3):
            d.ellipse([cx + ex * s - 0.17 * s, cy - 0.07 * s, cx + ex * s + 0.17 * s, cy + 0.23 * s], outline=(50, 50, 60), width=max(2, int(0.035 * s)))
        d.line([cx - 0.13 * s, cy + 0.08 * s, cx + 0.13 * s, cy + 0.08 * s], fill=(50, 50, 60), width=max(2, int(0.035 * s)))
    d.ellipse([cx - 0.06 * s, cy + 0.22 * s, cx + 0.06 * s, cy + 0.34 * s], fill=darker(skin, 35))
    d.arc([cx - 0.28 * s, cy + 0.25 * s, cx + 0.28 * s, cy + 0.6 * s], 20, 160, fill=(150, 60, 60), width=max(2, int(0.05 * s)))
    if not female and not child and r.random() < 0.3:
        d.chord([cx - 0.55 * s, cy + 0.25 * s, cx + 0.55 * s, cy + 0.95 * s], 0, 180, fill=hair)


db = sqlite3.connect(os.path.join(data, 'bible_questions.db'))
households = {}
for pid, gender, address in db.execute('SELECT id, gender, address FROM directory ORDER BY address, id'):
    households.setdefault(address, []).append((pid, gender))

for people in households.values():
    key = '-'.join(str(pid) for pid, _ in people)
    r = random.Random(key)
    n = len(people)
    w, h = (420, 420) if n == 1 else (260 * n + 80, 420)
    im = backdrop(w, h, *r.choice(BACKDROP))
    d = ImageDraw.Draw(im)
    for i, (_, gender) in enumerate(people):
        face(d, w / 2 if n == 1 else 170 + i * 260, 170, 120 if n == 1 else 95, r, gender == 'female', i >= 2)
    name = 'guide-' + hashlib.sha1(key.encode()).hexdigest()[:16] + '.png'
    im.save(os.path.join(photos, name))
    db.executemany('UPDATE directory SET photo = ? WHERE id = ?', [(name, pid) for pid, _ in people])

db.commit()
print(f'  {len(households)} portraits drawn')
