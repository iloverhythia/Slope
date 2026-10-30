"""Legacy steering for the page's Legacy mode: the original game's steering,
where a force builds up sideways speed and the ball keeps sliding after the
key is let go, as a second set of states in the ControlManager FSMs.

  Legacy Wait          the wait state without its "Stop Sideways" action
  Legacy Steer <side>  AddForce on the ball every frame instead of SetVelocity
  LegacySteerOn        global event: go to Legacy Wait
  LegacySteerOff       global event: back to the instant WaitForInput

Every new run's Reset Game already goes back to WaitForInput, so a run is
instant unless the page sends LegacySteerOn (to the ControlManager object).

The steer values were scaled for instant steering (patch_steering: 480 N
became 8 units/s), so the legacy push is an impulse of that each frame:
8 on the 30 kg ball, close to the original 480 N force.
"""
import copy
import struct

import pmfsm
import patch_menu
from patch_steering import split_actions, set_params, FSM_VECTOR3_NONE, SET_VELOCITY

ADD_FORCE = 'HutongGames.PlayMaker.Actions.AddForce'
ADD_FORCE_HASH = 28622334   # the original Steer states' AddForce
IMPULSE = 1                 # ForceMode.Impulse
ON, OFF = 'LegacySteerOn', 'LegacySteerOff'
WAIT, LEGACY_WAIT = 'WaitForInput', 'Legacy Wait'


def read_rest(fsm):
    """The events and global transitions at the start of the FSM's rest."""
    r = pmfsm.R(fsm['rest'])
    events = [(r.s(), r.i32(), r.i32()) for _ in range(r.i32())]
    globals_ = [dict(event=r.s(), isSystemEvent=r.i32(), isGlobal=r.i32(), toState=r.s(),
                     linkStyle=r.i32(), linkConstraint=r.i32(), colorIndex=r.i32()) for _ in range(r.i32())]
    return events, globals_, fsm['rest'][r.p:]


def write_rest(fsm, events, globals_, tail):
    w = pmfsm.W()
    w.i32(len(events))
    for name, system, glob in events:
        w.s(name); w.i32(system); w.i32(glob)
    w.i32(len(globals_))
    for t in globals_:
        w.s(t['event']); w.i32(t['isSystemEvent']); w.i32(t['isGlobal']); w.s(t['toState'])
        w.i32(t['linkStyle']); w.i32(t['linkConstraint']); w.i32(t['colorIndex'])
    fsm['rest'] = bytes(w.b) + tail


def patch(raw):
    fsm = pmfsm.parse(raw)
    if any(s['name'] == LEGACY_WAIT for s in fsm['states']):
        return raw, ['already patched']
    wait = patch_menu.find_state(fsm, WAIT)
    steer = next(s for s in fsm['states'] if s['name'].startswith('Steer '))
    side = steer['name'][len('Steer '):]
    legacy_steer = 'Legacy Steer ' + side

    # Legacy Wait: waits for a key like WaitForInput, but never stops the ball.
    lw = copy.deepcopy(wait)
    acts = [a for a in split_actions(lw['actions']) if a[0] != SET_VELOCITY]
    set_params(lw['actions'], acts)
    lw['name'] = LEGACY_WAIT
    lw['description'] = 'Legacy steering (the page\'s Legacy mode): waits for a key; the ball keeps its sideways speed.'
    lw['position'] = [wait['position'][0], wait['position'][1] + 160, wait['position'][2], wait['position'][3]]
    lw['transitions'] = [dict(t, toState=legacy_steer) for t in wait['transitions']]

    # Legacy Steer: pushes the ball sideways every frame while the key is held.
    ls = copy.deepcopy(steer)
    acts = split_actions(ls['actions'])
    for act in acts:
        if act[0] == SET_VELOCITY:
            p = {name: (name, t, payload) for name, t, payload in act[3]}
            act[0], act[1], act[2] = ADD_FORCE, 'Legacy Push ' + side, ADD_FORCE_HASH
            act[3] = [p['gameObject'], ('atPosition', pmfsm.FSM_VECTOR3, FSM_VECTOR3_NONE), p['vector'],
                      p['x'], p['y'], p['z'], p['space'],
                      ('forceMode', pmfsm.ENUM, struct.pack('<i', IMPULSE)), p['everyFrame']]
    assert any(a[0] == ADD_FORCE for a in acts), 'no SetVelocity in ' + steer['name']
    set_params(ls['actions'], acts)
    ls['name'] = legacy_steer
    ls['description'] = 'Legacy steering: a push every frame, as in the original game.'
    ls['position'] = [steer['position'][0], steer['position'][1] + 160, steer['position'][2], steer['position'][3]]
    ls['transitions'] = [dict(t, toState=LEGACY_WAIT) for t in steer['transitions']]
    fsm['states'] += [lw, ls]

    # The switches, from any state.
    events, globals_, tail = read_rest(fsm)
    events += [(ON, 0, 1), (OFF, 0, 1)]
    events.sort(key=lambda e: (e[0] != 'FINISHED', e[0]))
    for event, to in ((ON, LEGACY_WAIT), (OFF, WAIT)):
        globals_.append(dict(event=event, isSystemEvent=0, isGlobal=1, toState=to, linkStyle=0, linkConstraint=0, colorIndex=0))
    write_rest(fsm, events, globals_, tail)

    for st in fsm['states']:
        patch_menu.validate(st['actions'], st['name'])
    return pmfsm.serialize(fsm), ['states ' + LEGACY_WAIT + ', ' + legacy_steer, 'events ' + ON + ', ' + OFF]
