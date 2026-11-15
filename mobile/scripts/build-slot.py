#!/usr/bin/env python3
"""Run a heavy native command under the shared M5 build lease. Never breaks locks."""
import os, sys, json, uuid, subprocess, pathlib, datetime, shutil, signal, time
lock=pathlib.Path.home()/'.local/state/ios-build-slot.lock.d'
lock.parent.mkdir(parents=True,exist_ok=True)
try: lock.mkdir()
except FileExistsError:
    print('BUILD_SLOT_WAIT: existing lease; coordinate with its owner. No lock removed.')
    try: print((lock/'owner.json').read_text())
    except OSError: pass
    sys.exit(75)
lease=str(uuid.uuid4())
owner={'agentId':os.environ.get('OPEN_RECORDINGS_AGENT_ID',os.environ.get('EARMARK_AGENT_ID','6117da33-6c7e-4ebe-8710-a81f2dec98af')),'project':'harmony','leaseId':lease,'pid':os.getpid(),'processStart':subprocess.check_output(['ps','-o','lstart=','-p',str(os.getpid())],text=True).strip(),'acquiredAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
(lock/'owner.json').write_text(json.dumps(owner))
child = None
pending_signal = None
def forward(signum, _frame):
    global pending_signal
    pending_signal = signum
    if child is not None:
        try: os.killpg(child.pid, signum)
        except ProcessLookupError: pass
for sig in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
    signal.signal(sig, forward)
def group_alive():
    if child is None: return False
    rows = subprocess.check_output(['ps', '-axo', 'pgid=,stat='], text=True)
    return any(int(parts[0]) == child.pid and not parts[1].startswith('Z')
               for row in rows.splitlines() if len(parts := row.split()) >= 2)
try:
    print('BUILD_SLOT_ACQUIRED',lease,flush=True)
    child=subprocess.Popen(sys.argv[1:], start_new_session=True)
    if pending_signal is not None: forward(pending_signal, None)
    rc=child.wait()
    while group_alive(): time.sleep(0.1)
    if pending_signal is not None: rc=128+pending_signal
finally:
    if child is not None:
        child.wait()
        while group_alive(): time.sleep(0.1)
    try:
        current=json.loads((lock/'owner.json').read_text())
        if current.get('leaseId')==lease: shutil.rmtree(lock); print('BUILD_SLOT_RELEASED',lease,flush=True)
        else: print('Lease changed; retained lock',flush=True)
    except FileNotFoundError: pass
sys.exit(rc)
