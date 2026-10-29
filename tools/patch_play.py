"""Make the main menu's Play button open the page's game mode picker.

The PLAY button sends resetPressed, which starts a run straight away. This
points it at a new event, ModesPressed, whose state signals #slope-play and
goes back to the menu; the page shows its mode picker and starts the run
itself by sending resetPressed (which the menu still answers). Both menu
variants (logged in to id.net or not) are changed.

The new event name is as long as the old one, so the button's event bytes
are replaced in place.
"""
import pmfsm
import patch_menu

OLD_EVENT = b'resetPressed'
NEW_EVENT = b'ModesPressed'
STATE = 'Mode Screen'
assert len(OLD_EVENT) == len(NEW_EVENT)


def patch(raw):
    fsm = pmfsm.parse(raw)
    if any(s['name'] == STATE for s in fsm['states']):
        return raw, ['already patched']
    log = []
    for sname in patch_menu.MENU_STATES:
        st = patch_menu.find_state(fsm, sname)
        a = st['actions']
        play = next(i for i, n in enumerate(a['actionNames'])
                    if n.endswith('.GUILayoutButton') and a['customNames'][i] == 'GUILayout Button PLAY')
        k = next(k for k in pmfsm.action_params(a, play) if a['paramName'][k] == 'sendEvent')
        pos, size = a['paramDataPos'][k], a['paramByteDataSize'][k]
        assert a['byteData'][pos:pos + size] == OLD_EVENT, a['byteData'][pos:pos + size]
        b = bytearray(a['byteData'])
        b[pos:pos + size] = NEW_EVENT
        a['byteData'] = bytes(b)
        st['transitions'].append(dict(event=NEW_EVENT.decode(), isSystemEvent=0, isGlobal=0, toState=STATE,
                                      linkStyle=0, linkConstraint=0, colorIndex=0))
        log.append(sname + ': PLAY sends ' + NEW_EVENT.decode())
    patch_menu.signal_state(fsm, STATE, '#slope-play', 'Asks the web page to show its game mode picker.', 150)
    patch_menu.register_events(fsm, [NEW_EVENT.decode()])
    for st in fsm['states']:
        patch_menu.validate(st['actions'], st['name'])
    log.append('state ' + STATE)
    return pmfsm.serialize(fsm), log
