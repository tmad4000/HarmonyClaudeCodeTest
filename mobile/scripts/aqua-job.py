#!/usr/bin/env python3
"""Finite Aqua release wrapper; plan contains metadata only, never credentials."""
import json, os, subprocess
from pathlib import Path
root=Path(__file__).resolve().parents[1]
assert subprocess.check_output(['launchctl','managername'],text=True).strip()=='Aqua'
plan=json.loads((root/'build/release-plan.json').read_text())
os.environ['OPEN_RECORDINGS_AGENT_ID']='6117da33-6c7e-4ebe-8710-a81f2dec98af'
command=['/opt/homebrew/bin/python3',str(root/'scripts/testflight.py'),'--platform','ios','--source',plan['source'],'--build',plan['build'],'--profile-path',plan['profilePath']]
if plan.get('upload') is True: command+=['--upload']
result=subprocess.run(['/opt/homebrew/bin/python3',str(root/'scripts/build-slot.py'),*command],cwd=root)
(root/'build/aqua-job.exit').write_text(str(result.returncode)+'\n')
raise SystemExit(result.returncode)
