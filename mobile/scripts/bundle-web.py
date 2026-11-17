#!/usr/bin/env python3
"""Package the same reviewed web tree; engine bytes remain unchanged."""
from pathlib import Path
import shutil, hashlib, json
root=Path(__file__).resolve().parents[1]
src=root.parent/'claude'; out=root/'www'
if out.exists(): shutil.rmtree(out)
shutil.copytree(src,out,ignore=shutil.ignore_patterns('test','*.py','__pycache__','*.md'))
index=(out/'index.html').read_text()
index=index.replace('width=device-width, initial-scale=1.0', 'width=device-width, initial-scale=1.0, viewport-fit=cover')
index=index.replace('</head>', '<style>.harmony-app{padding-top:env(safe-area-inset-top);box-sizing:border-box}</style></head>')
index=index.replace('<script defer src="harmony-wit-feedback.js"', '<script src="native-bridge.js"></script>\n    <script defer src="harmony-wit-feedback.js"')
index=index.replace('<script src="update-guard.js"></script>', '')
(out/'index.html').write_text(index)
(out/'sw.js').unlink(missing_ok=True)
(out/'neural-experiment.html').unlink(missing_ok=True)
shutil.copyfile(root/'native-bridge.js',out/'native-bridge.js')
shutil.copyfile(root/'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png',out/'harmony-app-icon.png')
# Native feedback opens a website in Safari, never downloads executable code.
(out/'harmony-wit-feedback.js').write_text("window.addEventListener('harmony-ui-ready',()=>{const m=document.querySelector('#harmony-feedback-mount');if(m){const b=document.createElement('button');b.textContent='Suggestion box';b.onclick=()=>window.Capacitor.Plugins.HarmonyAudioSession.openFeedback();m.replaceChildren(b);}}, {once:true});")
manifest={str(p.relative_to(out)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(out.rglob('*')) if p.is_file()}
(out/'native-bundle.json').write_text(json.dumps(manifest,indent=2)+'\n')
assert (out/'harmony-app.js').read_bytes()==(src/'harmony-app.js').read_bytes()
print('Bundled',len(manifest),'files; harmony engine unchanged')
