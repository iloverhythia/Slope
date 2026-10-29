"""Apply Slope's data patches to Build/slope_data.unityweb in place.

    pip install UnityPy
    python tools/patch_data.py Build/slope_data.unityweb

Safe to run again: each patch skips what is already applied.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import UnityPy
import webdata
import patch_steering
import patch_menu
import patch_skin
import patch_sound

def main(path):
    files = webdata.read(open(path, 'rb').read())
    bundle = next(f for f in files if f[0] == 'data.unity3d')
    env = UnityPy.load(bundle[1])
    for o in env.objects:
        if o.type.name != 'MonoBehaviour':
            continue
        key = (o.assets_file.name, o.path_id)
        if key in (('level0', 272), ('level0', 273)):
            o.set_raw_data(patch_steering.patch_control(o.get_raw_data())); print('steering FSM', key[1])
        elif key == ('level0', 299):
            data, changed = patch_steering.patch_speed(o.get_raw_data()); o.set_raw_data(data); print('Speedmanager', changed)
        elif key == ('resources.assets', 21):
            data, changed = patch_steering.patch_globals(o.get_raw_data()); o.set_raw_data(data); print('globals', changed)
        elif key == ('level0', 283):
            data, log = patch_menu.patch(o.get_raw_data())
            data, log2 = patch_menu.patch_more(data)
            o.set_raw_data(data); print('EventManager', log + log2)
        elif key == ('sharedassets0.assets', 448):
            data, log = patch_skin.patch(o.get_raw_data()); o.set_raw_data(data); print('RetroGUISkin', log)
        elif key in (patch_sound.IMAGE, patch_sound.BUTTON):
            data, log = patch_sound.patch(key, o.get_raw_data()); o.set_raw_data(data); print('SoundButton', log)
    bundle[1] = env.file.save(packer='original')
    open(path, 'wb').write(webdata.write(files))

if __name__ == '__main__':
    main(sys.argv[1])
