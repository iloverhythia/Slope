"""Hide the game's own sound button: the music switch lives in the page's
Settings panel now (TemplateData/audio.js, TemplateData/settings.js).

The button (GameObject "SoundButton", shown by the menus) is a uGUI Image
and Button with a SoundButtonHandler script. Turning off the Image and the
Button components (m_Enabled, the byte after the MonoBehaviour's game
object pointer) leaves nothing to see or click; the handler stays as it is.
"""

IMAGE = ('level0', 322)
BUTTON = ('level0', 321)
ENABLED_AT = 12   # m_GameObject is a 12-byte PPtr (file id, path id)


def patch(key, raw):
    if key not in (IMAGE, BUTTON):
        return raw, None
    name = 'Image' if key == IMAGE else 'Button'
    if raw[ENABLED_AT] == 0:
        return raw, name + ' already off'
    out = bytearray(raw)
    out[ENABLED_AT] = 0
    return bytes(out), name + ' turned off'
