"""Add a compact menu button style to Slope's GUI skin (RetroGUISkin).

The main menu's buttons use the skin's "button" style (60 pt lettering).
Seven buttons don't fit on a typical screen at that size, so this adds
"menubutton": the same style (same box, colours, hover and font) with
smaller lettering. Other screens keep "button".

GUISkin layout (Unity 2017.4, no type tree in this build): the MonoBehaviour
header, the skin font, 20 built-in GUIStyles, the custom style array, then
the skin settings. A GUIStyle is its name, 8 states (background pointer and
text colour), 4 rect offsets, font, font size, style and alignment, two
bools, clipping, image position, content offset, fixed size and two bools.
"""
import struct
import pmfsm

MENU_STYLE = 'menubutton'
MENU_FONT_SIZE = 38


def read_style(r):
    start = r.p
    name = r.s()
    after_name = r.p
    for _ in range(8):
        r.i32(); r.i64(); r.p += 16          # background, text colour
    r.p += 4 * 16                            # border, margin, padding, overflow
    r.i32(); r.i64()                         # font
    font_size_at = r.p
    r.p += 12                                # font size, font style, alignment
    r.p += 2; r.align()                      # word wrap, rich text
    r.p += 8 + 8                             # clipping and image position, content offset
    r.p += 8                                 # fixed width, fixed height
    r.p += 2; r.align()                      # stretch width, stretch height
    return dict(name=name, start=start, after_name=after_name, end=r.p, font_size_at=font_size_at)


def parse(raw):
    r = pmfsm.R(raw)
    r.i32(); r.i64(); r.i32(); r.i32(); r.i64()   # game object, enabled, script
    r.s()                                         # name
    r.i32(); r.i64()                              # font
    builtin = [read_style(r) for _ in range(20)]
    count_at = r.p
    custom = [read_style(r) for _ in range(r.i32())]
    return builtin, count_at, custom, r.p


def patch(raw):
    builtin, count_at, custom, custom_end = parse(raw)
    if any(s['name'] == MENU_STYLE for s in custom):
        return raw, 'already patched'
    button = next(s for s in builtin if s['name'] == 'button')
    w = pmfsm.W(); w.s(MENU_STYLE)
    body = bytearray(raw[button['after_name']:button['end']])
    struct.pack_into('<i', body, button['font_size_at'] - button['after_name'], MENU_FONT_SIZE)
    style = bytes(w.b) + bytes(body)
    out = bytearray(raw[:custom_end]) + style + raw[custom_end:]
    struct.pack_into('<i', out, count_at, len(custom) + 1)
    # Check: the result parses and ends where it should.
    b2, _, c2, end2 = parse(bytes(out))
    assert c2[-1]['name'] == MENU_STYLE and end2 == custom_end + len(style)
    return bytes(out), 'added %s (%d pt)' % (MENU_STYLE, MENU_FONT_SIZE)
