"""Add a Career button to Slope's main menu and send signals the page can read.

PlayMaker's log actions print nothing in this build, so the signals use the
game's ApplicationOpenUrl action. Unity 2017 WebGL implements it as
location.href = url, so each signal is a page hash (#slope-...): the page
hears it as a hashchange, handles it and clears the hash. Nothing navigates.

Edits the EventManager PlayMakerFSM (level0, path 283):
  - "start game"         #slope-run-start
  - both death states    #slope-score-<final score>
  - main menu (both variants) gets a "Career" button between Play and Credits,
    with tighter spacing so five buttons fit
  - new event CareerPressed -> new state "Career Screen" that signals
    #slope-career and returns to the menu
"""
import struct
import pmfsm

OPEN_URL = 'HutongGames.PlayMaker.Actions.ApplicationOpenUrl'
OPEN_URL_HASH = 25866404
INT_TO_STRING = 'HutongGames.PlayMaker.Actions.ConvertIntToString'
INT_TO_STRING_HASH = 82332992
MENU_STATES = {'Name entry screen NotLoggedIn': 0.19, 'Name entry screen': 0.17}  # new area top
MENU_SPACE = 6.0

# Which ActionData list each list-stored param type indexes (derived from every
# PlayMaker FSM in the game). All other types live in byteData, in param order.
LIST_GROUPS = {5: 'unityObjectParams', 12: 'arrays', 18: 'fsmStringParams', 19: 'fsmGameObjectParams',
               20: 'fsmOwnerDefaultParams', 21: 'functionCallParams', 24: 'fsmObjectParams',
               31: 'fsmEventTargetParams', 33: 'fsmObjectParams', 36: 'fsmPropertyParams', 39: 'fsmVarParams'}

# Types normally kept in byteData; with no bytes they sit in their own list.
TYPED_LISTS = {15: 'fsmFloatParams', 16: 'fsmIntParams', 17: 'fsmBoolParams', 28: 'fsmVector3Params'}

def group_of(t, size=1):
    if t in LIST_GROUPS:
        return LIST_GROUPS[t]
    if size == 0 and t in TYPED_LISTS:
        return TYPED_LISTS[t]
    return 'bytes'

def param_group(a, k):
    return group_of(a['paramDataType'][k], a['paramByteDataSize'][k])

def fsm_string(value='', var=''):
    w = pmfsm.W(); w.i32(1 if var else 0); w.s(var); w.s(''); w.i32(0); w.i32(0); w.s(value)
    return bytes(w.b)

def string_value(item):
    r = pmfsm.R(item); r.i32(); r.s(); r.s(); r.i32(); r.i32(); return r.s()

def insert_action(a, at, name, custom, hash_code, params):
    """Insert an action before action index `at` (or append when at == len).
    params: [(paramName, type, payload)]; payload is bytes for byte-stored params,
    an element (bytes) for list groups, or the array type name for arrays."""
    k0 = a['actionStartIndex'][at] if at < len(a['actionNames']) else len(a['paramName'])
    # Where new data goes in each store: right after what earlier params use.
    byte_off, counts = 0, {}
    for k in range(k0):
        g = param_group(a, k)
        if g == 'bytes':
            byte_off = max(byte_off, a['paramDataPos'][k] + a['paramByteDataSize'][k])
        else:
            counts[g] = max(counts.get(g, 0), a['paramDataPos'][k] + 1)
    new_bytes, new_items, entries = bytearray(), {}, []
    for pname, t, payload in params:
        g = group_of(t, len(payload) if isinstance(payload, (bytes, bytearray)) else 1)
        if g == 'bytes':
            entries.append((pname, t, byte_off + len(new_bytes), len(payload))); new_bytes += payload
        else:
            idx = counts.get(g, 0) + len(new_items.setdefault(g, []))
            new_items[g].append(payload); entries.append((pname, t, idx, 0))
    # Shift params after the insertion point: their data now starts later.
    for k in range(k0, len(a['paramName'])):
        g = param_group(a, k)
        if g == 'bytes':
            a['paramDataPos'][k] += len(new_bytes)
        elif g in new_items:
            a['paramDataPos'][k] += len(new_items[g])
    a['byteData'] = a['byteData'][:byte_off] + bytes(new_bytes) + a['byteData'][byte_off:]
    for g, items in new_items.items():
        at_i = counts.get(g, 0)
        if g == 'arrays':
            for j, type_name in enumerate(items):
                a['arrayParamSizes'].insert(at_i + j, 0); a['arrayParamTypes'].insert(at_i + j, type_name)
        else:
            a[g][at_i:at_i] = items
    for j, (pname, t, pos, size) in enumerate(entries):
        a['paramName'].insert(k0 + j, pname); a['paramDataType'].insert(k0 + j, t)
        a['paramDataPos'].insert(k0 + j, pos); a['paramByteDataSize'].insert(k0 + j, size)
    a['actionNames'].insert(at, name); a['customNames'].insert(at, custom); a['actionHashCodes'].insert(at, hash_code)
    a['actionEnabled'] = a['actionEnabled'][:at] + b'\x01' + a['actionEnabled'][at:]
    a['actionIsOpen'] = a['actionIsOpen'][:at] + b'\x01' + a['actionIsOpen'][at:]
    a['actionStartIndex'].insert(at, k0)
    for i in range(at + 1, len(a['actionStartIndex'])):
        a['actionStartIndex'][i] += len(params)

def open_url_params(url='', url_var=''):
    return [('url', 18, fsm_string(url, url_var)), ('WebWindowTitle', 18, fsm_string('slope'))]

def score_signal(a):
    """Write "#slope-score-<Score>" into AllScores (the game resets it to
    "loading" right after) and open it."""
    insert_action(a, 0, OPEN_URL, 'Slope page: final score', OPEN_URL_HASH, open_url_params(url_var='AllScores'))
    insert_action(a, 0, INT_TO_STRING, 'Slope page: score text', INT_TO_STRING_HASH, [
        ('intVariable', 16, struct.pack('<i', 0) + b'\x01Score'),
        ('stringVariable', 18, fsm_string(var='AllScores')),
        ('format', 18, fsm_string("'#slope-score-'0")),
        ('everyFrame', 1, b'\x00')])

def validate(a, where):
    """Every param must point inside its store, and byteData must be used in order."""
    expect = 0
    for k, t in enumerate(a['paramDataType']):
        g, pos, size = param_group(a, k), a['paramDataPos'][k], a['paramByteDataSize'][k]
        if g == 'bytes':
            if size == 0:
                continue  # e.g. an empty event: nothing is read, whatever its position
            assert pos == expect and pos + size <= len(a['byteData']), (where, k, a['paramName'][k], pos, expect)
            expect += size
        else:
            store = a['arrayParamSizes'] if g == 'arrays' else a[g]
            assert pos < len(store), (where, k, a['paramName'][k], t, pos, len(store))
    assert expect == len(a['byteData']), (where, 'byteData length')
    assert len(a['actionStartIndex']) == len(a['actionNames']) == len(a['actionHashCodes'])

def empty_action_data():
    a = {k: ([] if k not in pmfsm.BYTE_LISTS else b'') for k in pmfsm.LISTS}
    return a

def find_state(fsm, name):
    return next(s for s in fsm['states'] if s['name'] == name)

def set_float(a, k, value):
    b = bytearray(a['byteData']); struct.pack_into('<f', b, a['paramDataPos'][k], value); a['byteData'] = bytes(b)

def patch(raw):
    fsm = pmfsm.parse(raw)
    names = [s['name'] for s in fsm['states']]
    if 'Career Screen' in names:
        return raw, ['already patched']
    log = []
    # 1. Run start marker.
    start = find_state(fsm, 'start game')['actions']
    insert_action(start, len(start['actionNames']), OPEN_URL, 'Slope page: run start', OPEN_URL_HASH,
                  open_url_params('#slope-run-start'))
    log.append('start game: run-start signal')
    # 2. Final score on death.
    for sname in ('fall death', 'collide death'):
        score_signal(find_state(fsm, sname)['actions'])
        log.append(sname + ': score signal')
    # 3. Career button in both main menu variants.
    for sname, top in MENU_STATES.items():
        st = find_state(fsm, sname); a = st['actions']
        credits = next(i for i, n in enumerate(a['actionNames'])
                       if n.endswith('.GUILayoutButton') and a['customNames'][i] == 'GUILayout Button Credits')
        space_i = credits - 1
        assert a['actionNames'][space_i].endswith('.GUILayoutSpace')
        cp = {a['paramName'][k]: k for k in pmfsm.action_params(a, credits)}
        def item(pname):
            k = cp[pname]; return a[param_group(a, k)][a['paramDataPos'][k]]
        storebytes = a['byteData'][a['paramDataPos'][cp['storeButtonState']]:][:a['paramByteDataSize'][cp['storeButtonState']]]
        button = [('sendEvent', 23, b'CareerPressed'), ('storeButtonState', 17, storebytes),
                  ('image', 33, item('image')), ('text', 18, fsm_string('Career')),
                  ('tooltip', 18, item('tooltip')), ('style', 18, item('style')),
                  ('layoutOptions', 12, 'HutongGames.PlayMaker.LayoutOption')]
        space_k = pmfsm.action_params(a, space_i)[0]
        space = [('space', 15, a['byteData'][a['paramDataPos'][space_k]:][:a['paramByteDataSize'][space_k]])]
        insert_action(a, credits, a['actionNames'][space_i], '', a['actionHashCodes'][space_i], space)
        insert_action(a, credits, a['actionNames'][credits + 1], 'GUILayout Button Career',
                      a['actionHashCodes'][credits + 1], button)
        # Tighter layout so five buttons fit: smaller gaps, area starts a bit higher.
        for i, n in enumerate(a['actionNames']):
            ks = pmfsm.action_params(a, i)
            if n.endswith('.GUILayoutSpace'):
                set_float(a, ks[0], MENU_SPACE)
            if n.endswith('.GUILayoutBeginArea'):
                kk = {a['paramName'][k]: k for k in ks}
                lft = struct.unpack_from('<f', a['byteData'], a['paramDataPos'][kk['left']])[0]
                if abs(lft - 0.33) < 0.01:
                    set_float(a, kk['top'], top)
        st['transitions'].append(dict(event='CareerPressed', isSystemEvent=0, isGlobal=0, toState='Career Screen',
                                      linkStyle=0, linkConstraint=0, colorIndex=0))
        log.append(sname + ': Career button added')
    # 4. Career Screen state: log a marker, go back to the menu.
    ad = empty_action_data()
    insert_action(ad, 0, OPEN_URL, 'Slope page: open Career', OPEN_URL_HASH, open_url_params('#slope-career'))
    menu = find_state(fsm, 'Name entry screen NotLoggedIn')
    fsm['states'].append(dict(name='Career Screen', description='Asks the web page to open its Career screen.',
                              colorIndex=0, position=[menu['position'][0] + 220, menu['position'][1], 120, 32],
                              isBreakpoint=0, isSequence=0, hideUnused=0,
                              transitions=[dict(event='FINISHED', isSystemEvent=1, isGlobal=0,
                                                toState='Name entry screen NotLoggedIn', linkStyle=0,
                                                linkConstraint=0, colorIndex=0)],
                              actions=ad))
    # 5. Register the new event (events list starts the rest of the FSM).
    r = pmfsm.R(fsm['rest']); n = r.i32(); events = [(r.s(), r.i32(), r.i32()) for _ in range(n)]
    tail = fsm['rest'][r.p:]
    events.append(('CareerPressed', 0, 0)); events.sort(key=lambda e: (e[0] != 'FINISHED', e[0]))
    w = pmfsm.W(); w.i32(len(events))
    for nm, sys_, glob in events: w.s(nm); w.i32(sys_); w.i32(glob)
    fsm['rest'] = bytes(w.b) + tail
    log.append('Career Screen state + CareerPressed event')
    for st in fsm['states']:
        validate(st['actions'], st['name'])
    return pmfsm.serialize(fsm), log
