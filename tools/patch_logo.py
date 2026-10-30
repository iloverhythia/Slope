"""The JHub Productions logo in place of the Y8 logo (the main menu's More
Games button, and the other Y8 pictures in the data).

Each Y8 texture is a white card with rounded corners. The new picture keeps
the card's shape (its alpha) and puts the logo in it, fitted to the card's
height and centred, with the sides filled with the logo's own background
gradient, so the logo is never stretched.

The logo comes from tools/jhub-logo.png.
"""
import os

from PIL import Image

LOGO = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'jhub-logo.png')
NAMES = ('y8_new_logo', 'y8_new_logo_smaller', 'y8_new_logo_smaller_offset')


def compose(original, logo):
    """The card of `original` (RGBA) with the logo on it."""
    original = original.convert('RGBA')
    w, h = original.size
    alpha = original.getchannel('A')
    box = alpha.point(lambda a: 255 if a > 8 else 0).getbbox() or (0, 0, w, h)
    bw, bh = box[2] - box[0], box[3] - box[1]
    # The logo's background, row by row: a strip between its frame and its lettering.
    logo = logo.convert('RGB')
    strip = logo.crop((int(logo.width * 0.07), 0, int(logo.width * 0.11), logo.height)).resize((1, bh), Image.BOX)
    card = Image.new('RGB', (bw, bh))
    for y in range(bh):
        card.paste(strip.getpixel((0, y)), (0, y, bw, y + 1))
    size = min(bw, bh)
    card.paste(logo.resize((size, size), Image.LANCZOS), ((bw - size) // 2, (bh - size) // 2))
    out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    out.paste(card, box[:2])
    # The card's shape, solid inside (the Y8 letters were a little more
    # opaque than the white around them, and would show through).
    out.putalpha(alpha.point(lambda a: 255 if a >= 200 else a))
    return out


def patch(env):
    """Replaces every Y8 texture in the loaded data; returns what it did."""
    logo = Image.open(LOGO)
    log = []
    for o in env.objects:
        if o.type.name != 'Texture2D':
            continue
        tex = o.read()
        if tex.m_Name not in NAMES:
            continue
        current = tex.image.convert('RGBA')
        new = compose(current, logo)
        if list(new.getdata()) == list(current.getdata()):
            log.append(tex.m_Name + ' already patched')
            continue
        tex.image = new
        tex.save()
        log.append(tex.m_Name + ' replaced')
    return log
