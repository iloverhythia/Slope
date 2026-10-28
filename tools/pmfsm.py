"""Read and write the serialized data of a PlayMakerFSM MonoBehaviour.

The game is an IL2CPP build, so Unity stores script data without a type tree.
This layout was decoded from the build itself (PlayMaker 1.8, Unity 2017.4):
little endian, 4-byte alignment after strings, byte lists and bools. States are
parsed fully; everything after the state list (events, variables, ...) is kept
as raw bytes. parse() followed by serialize() gives back the input exactly.
"""
import struct


class R:
    def __init__(self, b, p=0):
        self.b, self.p = b, p

    def i32(self):
        v = struct.unpack_from('<i', self.b, self.p)[0]; self.p += 4; return v

    def f32(self):
        v = struct.unpack_from('<f', self.b, self.p)[0]; self.p += 4; return v

    def i64(self):
        v = struct.unpack_from('<q', self.b, self.p)[0]; self.p += 8; return v

    def align(self):
        self.p = (self.p + 3) & ~3

    def s(self):
        n = self.i32(); v = self.b[self.p:self.p + n].decode('utf-8'); self.p += n; self.align(); return v

    def bytelist(self):
        n = self.i32(); v = bytes(self.b[self.p:self.p + n]); self.p += n; self.align(); return v


class W:
    def __init__(self):
        self.b = bytearray()

    def i32(self, v): self.b += struct.pack('<i', v)
    def f32(self, v): self.b += struct.pack('<f', v)
    def i64(self, v): self.b += struct.pack('<q', v)

    def align(self):
        while len(self.b) % 4:
            self.b.append(0)

    def s(self, v):
        e = v.encode('utf-8'); self.i32(len(e)); self.b += e; self.align()

    def bytelist(self, v):
        self.i32(len(v)); self.b += v; self.align()


# --- Element readers for list-stored params ----------------------------------
# Each only advances the reader; elements are kept as raw bytes.

def _named_variable(r):  # useVariable, name, tooltip, showInInspector, networkSync
    r.i32(); r.s(); r.s(); r.i32(); r.i32()

def _pptr(r): r.i32(); r.i64()
def _fsm_bool(r): _named_variable(r); r.i32()
def _fsm_float(r): _named_variable(r); r.f32()
def _fsm_int(r): _named_variable(r); r.i32()
def _fsm_string(r): _named_variable(r); r.s()
def _fsm_gameobject(r): _named_variable(r); _pptr(r)
def _fsm_object(r): _named_variable(r); r.s(); _pptr(r)
def _fsm_enum(r): _named_variable(r); r.s(); r.i32()
def _fsm_owner(r): r.i32(); _fsm_gameobject(r)

def _fsm_vec(n):
    def read(r):
        _named_variable(r)
        for _ in range(n): r.f32()
    return read

def _fsm_array(r):
    _named_variable(r); r.i32(); r.s()
    for _ in range(r.i32()): r.f32()
    for _ in range(r.i32()): r.i32()
    r.bytelist()
    for _ in range(r.i32()): r.s()
    for _ in range(r.i32()): [r.f32() for _ in range(4)]
    for _ in range(r.i32()): _pptr(r)

def _seq(*fields):
    def read(r):
        for f in fields: f(r)
    return read

_int = lambda r: r.i32()
_str = lambda r: r.s()
_vec4 = lambda r: [r.f32() for _ in range(4)]

ELEMENT_READERS = {
    'unityObjectParams': _pptr,
    'fsmGameObjectParams': _fsm_gameobject,
    'functionCallParams': _seq(_str, _str, _fsm_bool, _fsm_float, _fsm_int, _fsm_gameobject, _fsm_object,
                               _fsm_string, _fsm_vec(2), _fsm_vec(3), _fsm_vec(4), _fsm_vec(4), _fsm_object,
                               _fsm_object, _fsm_vec(4), _fsm_enum, _fsm_array),
    'fsmEventTargetParams': _seq(_int, _fsm_bool, _fsm_owner, _fsm_string, _fsm_bool, _pptr),
    'fsmPropertyParams': _seq(_fsm_object, _str, _str, _fsm_bool, _fsm_float, _fsm_int, _fsm_gameobject,
                              _fsm_string, _fsm_vec(2), _fsm_vec(3), _fsm_vec(4), _fsm_vec(4), _fsm_object,
                              _fsm_object, _fsm_object, _fsm_vec(4), _fsm_enum, _fsm_array, _int),
    'layoutOptionParams': _seq(_int, _fsm_float, _fsm_bool),
    'fsmStringParams': _fsm_string,
    'fsmObjectParams': _fsm_object,
    'fsmVarParams': _seq(_str, _str, _int, _int, lambda r: r.f32(), _int, _int, _str, _vec4, _pptr, _fsm_array),
    'fsmArrayParams': _fsm_array,
    'fsmEnumParams': _fsm_enum,
    'fsmFloatParams': _fsm_float,
    'fsmIntParams': _fsm_int,
    'fsmBoolParams': _fsm_bool,
    'fsmVector2Params': _fsm_vec(2),
    'fsmVector3Params': _fsm_vec(3),
    'fsmColorParams': _fsm_vec(4),
    'fsmRectParams': _fsm_vec(4),
    'fsmQuaternionParams': _fsm_vec(4),
}

# --- ActionData ----------------------------------------------------------------

# Lists in serialized order.
LISTS = ['actionNames', 'customNames', 'actionEnabled', 'actionIsOpen', 'actionStartIndex', 'actionHashCodes',
         'unityObjectParams', 'fsmGameObjectParams', 'fsmOwnerDefaultParams',
         'animationCurveParams', 'functionCallParams', 'fsmTemplateControlParams', 'fsmEventTargetParams',
         'fsmPropertyParams', 'layoutOptionParams', 'fsmStringParams', 'fsmObjectParams', 'fsmVarParams',
         'fsmArrayParams', 'fsmEnumParams', 'fsmFloatParams', 'fsmIntParams', 'fsmBoolParams',
         'fsmVector2Params', 'fsmVector3Params', 'fsmColorParams', 'fsmRectParams', 'fsmQuaternionParams',
         'stringParams', 'byteData', 'arrayParamSizes', 'arrayParamTypes', 'customTypeSizes', 'customTypeNames',
         'paramDataType', 'paramName', 'paramDataPos', 'paramByteDataSize']
STRING_LISTS = {'actionNames', 'customNames', 'arrayParamTypes', 'customTypeNames', 'paramName', 'stringParams'}
BYTE_LISTS = {'actionEnabled', 'actionIsOpen', 'byteData'}
INT_LISTS = {'actionStartIndex', 'actionHashCodes', 'arrayParamSizes', 'customTypeSizes', 'paramDataType',
             'paramDataPos', 'paramByteDataSize'}

# ParamDataType values used by the patches.
BOOL, ENUM, FSM_FLOAT, FSM_INT, FSM_BOOL, FSM_STRING, OWNER_DEFAULT, FSM_EVENT, FSM_VECTOR3 = 1, 7, 15, 16, 17, 18, 20, 23, 28


def read_owner_default(r):
    return dict(ownerOption=r.i32(), useVariable=r.i32(), name=r.s(), tooltip=r.s(), showInInspector=r.i32(),
                networkSync=r.i32(), fileID=r.i32(), pathID=r.i64())


def write_owner_default(w, o):
    w.i32(o['ownerOption']); w.i32(o['useVariable']); w.s(o['name']); w.s(o['tooltip'])
    w.i32(o['showInInspector']); w.i32(o['networkSync']); w.i32(o['fileID']); w.i64(o['pathID'])


def read_action_data(r):
    a = {}
    for k in LISTS:
        if k in BYTE_LISTS:
            a[k] = r.bytelist()
        elif k in STRING_LISTS:
            a[k] = [r.s() for _ in range(r.i32())]
        elif k in INT_LISTS:
            a[k] = [r.i32() for _ in range(r.i32())]
        elif k == 'fsmOwnerDefaultParams':
            a[k] = [read_owner_default(r) for _ in range(r.i32())]
        else:
            n, items = r.i32(), []
            if n and k not in ELEMENT_READERS:
                raise ValueError('unsupported non-empty list %s at %d' % (k, r.p))
            for _ in range(n):
                start = r.p; ELEMENT_READERS[k](r); items.append(bytes(r.b[start:r.p]))
            a[k] = items
    return a


def write_action_data(w, a):
    for k in LISTS:
        v = a[k]
        if k in BYTE_LISTS:
            w.bytelist(v)
        elif k in STRING_LISTS:
            w.i32(len(v)); [w.s(x) for x in v]
        elif k in INT_LISTS:
            w.i32(len(v)); [w.i32(x) for x in v]
        elif k == 'fsmOwnerDefaultParams':
            w.i32(len(v)); [write_owner_default(w, o) for o in v]
        else:
            w.i32(len(v))
            for item in v:
                w.b += item


# --- FSM -----------------------------------------------------------------------

def parse(raw):
    r = R(raw)
    r.p = 32  # MonoBehaviour header: m_GameObject, m_Enabled, m_Script, m_Name
    head = dict(dataVersion=r.i32(), templateFileID=r.i32(), templatePathID=r.i64(), name=r.s(), startState=r.s())
    states = []
    for _ in range(r.i32()):
        st = dict(name=r.s(), description=r.s(), colorIndex=r.i32(), position=[r.f32() for _ in range(4)],
                  isBreakpoint=r.i32(), isSequence=r.i32(), hideUnused=r.i32())
        st['transitions'] = [dict(event=r.s(), isSystemEvent=r.i32(), isGlobal=r.i32(), toState=r.s(),
                                  linkStyle=r.i32(), linkConstraint=r.i32(), colorIndex=r.i32())
                             for _ in range(r.i32())]
        st['actions'] = read_action_data(r)
        states.append(st)
    return dict(prefix=bytes(raw[:32]), head=head, states=states, rest=bytes(raw[r.p:]))


def serialize(fsm):
    w = W(); w.b += fsm['prefix']; h = fsm['head']
    w.i32(h['dataVersion']); w.i32(h['templateFileID']); w.i64(h['templatePathID']); w.s(h['name']); w.s(h['startState'])
    w.i32(len(fsm['states']))
    for st in fsm['states']:
        w.s(st['name']); w.s(st['description']); w.i32(st['colorIndex']); [w.f32(x) for x in st['position']]
        w.i32(st['isBreakpoint']); w.i32(st['isSequence']); w.i32(st['hideUnused'])
        w.i32(len(st['transitions']))
        for t in st['transitions']:
            w.s(t['event']); w.i32(t['isSystemEvent']); w.i32(t['isGlobal']); w.s(t['toState'])
            w.i32(t['linkStyle']); w.i32(t['linkConstraint']); w.i32(t['colorIndex'])
        write_action_data(w, st['actions'])
    w.b += fsm['rest']
    return bytes(w.b)


def action_params(a, i):
    """Indexes of the params that belong to action i."""
    start = a['actionStartIndex'][i]
    end = a['actionStartIndex'][i + 1] if i + 1 < len(a['actionStartIndex']) else len(a['paramName'])
    return list(range(start, end))


def decode_param(a, k):
    """Decode a byte-stored param (or return an FsmOwnerDefault entry)."""
    t, pos, size = a['paramDataType'][k], a['paramDataPos'][k], a['paramByteDataSize'][k]
    b = a['byteData'][pos:pos + size]
    if t == OWNER_DEFAULT:
        return a['fsmOwnerDefaultParams'][pos]
    if t == FSM_FLOAT:
        return dict(value=struct.unpack_from('<f', b)[0], useVariable=b[4], var=b[5:].decode())
    if t == FSM_VECTOR3:
        return dict(value=struct.unpack_from('<3f', b), useVariable=b[12], var=b[13:].decode())
    if t == ENUM:
        return struct.unpack_from('<i', b)[0]
    if t == BOOL:
        return b[0]
    return b
