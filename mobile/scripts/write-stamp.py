from pathlib import Path
import json, subprocess, sys
from release_source import checked_source
root=Path(__file__).resolve().parents[2]
sha=sys.argv[1]; build=sys.argv[2]
time=checked_source(root,sha)
stamp={'commit':sha,'commitTime':time,'dirty':False,'event':'commit','version':'0.1.0','build':build}
(root/'mobile/ios/App/App/HarmonyBuildInfo.json').write_text(json.dumps(stamp,indent=2)+'\n')
