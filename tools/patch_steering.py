"""Make Slope's steering instant: sideways speed is set directly while a key
is held and stopped when it is released, instead of building up from a force.

Edits the PlayMaker FSMs in data.unity3d:
  ControlManager FSM Left/Right  - Steer state: AddForce -> SetVelocity (x = SteerForce)
                                 - WaitForInput: new SetVelocity x = 0 on entry
  Speedmanager                   - steer values scaled from forces to speeds
  PlayMakerGlobals               - SteerForceLeft/Right defaults scaled the same way
"""
import struct, sys
import UnityPy
import pmfsm

SCALE = 1 / 60.0  # 480 N on the 30 kg ball becomes 8 units/s sideways
SET_VELOCITY = 'HutongGames.PlayMaker.Actions.SetVelocity'
SET_VELOCITY_HASH = 95244885  # same field layout as GetPosition in the ball's FSM

def params_of(a):
    """Every param as (name, type, payload); payload is bytes or an owner dict."""
    out, expect = [], 0
    for k in range(len(a['paramName'])):
        t, pos, size = a['paramDataType'][k], a['paramDataPos'][k], a['paramByteDataSize'][k]
        if t == pmfsm.OWNER_DEFAULT:
            out.append((a['paramName'][k], t, a['fsmOwnerDefaultParams'][pos]))
        else:
            assert pos == expect, 'byteData not sequential'
            out.append((a['paramName'][k], t, a['byteData'][pos:pos + size])); expect += size
    assert expect == len(a['byteData'])
    return out

def set_params(a, actions):
    """actions: list of (name, customName, hash, params). Rebuilds every param list."""
    a['actionNames'] = [x[0] for x in actions]
    a['customNames'] = [x[1] for x in actions]
    a['actionHashCodes'] = [x[2] for x in actions]
    a['actionEnabled'] = bytes([1] * len(actions))
    a['actionIsOpen'] = bytes([1] * len(actions))
    a['actionStartIndex'], a['paramName'], a['paramDataType'] = [], [], []
    a['paramDataPos'], a['paramByteDataSize'], a['fsmOwnerDefaultParams'] = [], [], []
    data = bytearray()
    for _, _, _, params in actions:
        a['actionStartIndex'].append(len(a['paramName']))
        for name, t, payload in params:
            a['paramName'].append(name); a['paramDataType'].append(t)
            if t == pmfsm.OWNER_DEFAULT:
                a['paramDataPos'].append(len(a['fsmOwnerDefaultParams'])); a['paramByteDataSize'].append(0)
                a['fsmOwnerDefaultParams'].append(payload)
            else:
                a['paramDataPos'].append(len(data)); a['paramByteDataSize'].append(len(payload)); data += payload
    a['byteData'] = bytes(data)

def split_actions(a):
    ps = params_of(a)
    out = []
    for i, name in enumerate(a['actionNames']):
        idx = pmfsm.action_params(a, i)
        out.append([name, a['customNames'][i], a['actionHashCodes'][i], [ps[k] for k in idx]])
    return out

def fsm_float(value, var=''):
    return struct.pack('<f', value) + bytes([1 if var else 0]) + var.encode()

FSM_FLOAT_NONE = struct.pack('<f', 0) + b'\x01'
FSM_VECTOR3_NONE = struct.pack('<3f', 0, 0, 0) + b'\x01'

def patch_control(raw):
    fsm = pmfsm.parse(raw)
    wait, steer = fsm['states']
    if SET_VELOCITY in steer['actions']['actionNames']:
        return raw  # already patched
    # Steer: AddForce -> SetVelocity, keeping gameObject, vector, x, y, z, space, everyFrame.
    acts = split_actions(steer['actions'])
    for act in acts:
        if act[0].endswith('.AddForce'):
            keep = ('gameObject', 'vector', 'x', 'y', 'z', 'space', 'everyFrame')
            act[3] = [p for p in act[3] if p[0] in keep]
            assert [p[0] for p in act[3]] == list(keep)
            act[0], act[1], act[2] = SET_VELOCITY, 'Steer Sideways', SET_VELOCITY_HASH
            ball = act[3][0][2]
    set_params(steer['actions'], acts)
    # WaitForInput: stop sideways movement as soon as the key is released.
    acts = split_actions(wait['actions'])
    stop = [SET_VELOCITY, 'Stop Sideways', SET_VELOCITY_HASH, [
        ('gameObject', pmfsm.OWNER_DEFAULT, dict(ball)),
        ('vector', pmfsm.FSM_VECTOR3, FSM_VECTOR3_NONE),
        ('x', pmfsm.FSM_FLOAT, fsm_float(0.0)),
        ('y', pmfsm.FSM_FLOAT, FSM_FLOAT_NONE),
        ('z', pmfsm.FSM_FLOAT, FSM_FLOAT_NONE),
        ('space', pmfsm.ENUM, struct.pack('<i', 0)),  # world space
        ('everyFrame', pmfsm.BOOL, b'\x00'),
    ]]
    set_params(wait['actions'], [stop] + acts)
    return pmfsm.serialize(fsm)

def scale_float_param(a, k):
    b = bytearray(a['byteData']); pos = a['paramDataPos'][k]
    v = struct.unpack_from('<f', b, pos)[0]; struct.pack_into('<f', b, pos, v * SCALE)
    a['byteData'] = bytes(b)
    return v, v * SCALE

def patch_speed(raw):
    fsm = pmfsm.parse(raw)
    changed = []
    for st in fsm['states']:
        a = st['actions']
        for i, name in enumerate(a['actionNames']):
            ks = pmfsm.action_params(a, i)
            names = [a['paramName'][k] for k in ks]
            target = pmfsm.decode_param(a, ks[0]) if names and names[0] == 'floatVariable' else None
            if not target or target['var'] not in ('SteerForceLeft', 'SteerForceRight'):
                continue
            for k in ks:
                value = pmfsm.decode_param(a, k)
                if a['paramName'][k] in ('floatValue', 'add', 'subtract') and abs(value['value']) in (480, 30, 100):
                    changed.append((st['name'], a['paramName'][k]) + scale_float_param(a, k))
    return pmfsm.serialize(fsm), changed

def patch_globals(raw):
    b = bytearray(raw); changed = []
    for name in (b'SteerForceLeft', b'SteerForceRight'):
        i = b.index(struct.pack('<i', len(name)) + name)
        p = i + 4 + len(name); p = (p + 3) & ~3          # end of name
        n = struct.unpack_from('<i', b, p)[0]; p += 4 + n; p = (p + 3) & ~3  # tooltip
        p += 8                                            # showInInspector, networkSync
        v = struct.unpack_from('<f', b, p)[0]
        if abs(abs(v) - 480) > 1e-3:
            continue  # already patched
        struct.pack_into('<f', b, p, v * SCALE); changed.append((name.decode(), v, v * SCALE))
    return bytes(b), changed

def main(src, dst):
    env = UnityPy.load(src)
    for o in env.objects:
        if o.type.name != 'MonoBehaviour': continue
        key = (o.assets_file.name, o.path_id)
        if key in (('level0', 272), ('level0', 273)):
            o.set_raw_data(patch_control(o.get_raw_data())); print('patched steering FSM', key)
        elif key == ('level0', 299):
            data, changed = patch_speed(o.get_raw_data()); o.set_raw_data(data); print('patched Speedmanager', changed)
        elif key == ('resources.assets', 21):
            data, changed = patch_globals(o.get_raw_data()); o.set_raw_data(data); print('patched globals', changed)
    open(dst, 'wb').write(env.file.save(packer='original'))

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
