#!/usr/bin/env python3
"""Verify one Harmony IPA/PKG before any upload, on the Apple build host."""
import datetime
import fnmatch
import hashlib
import json
from pathlib import Path, PurePosixPath
import plistlib
import subprocess
import tempfile
import zipfile
import sys
sys.dont_write_bytecode = True
from release_source import checked_source
from package_signer import require_installer
from provision_profile import verify_profile

TEAM = 'JESMXK96LG'
BUNDLE = 'com.ideaflow.harmony'
DISTRIBUTION = '300FAAFC4D696C4B886638DECE3E1319C3D0082E'

def allowed(value, authorization):
    if isinstance(value, dict):
        return isinstance(authorization, dict) and all(k in authorization and allowed(v, authorization[k]) for k,v in value.items())
    if isinstance(value, list):
        return isinstance(authorization, list) and all(any(allowed(v,c) for c in authorization) for v in value)
    if isinstance(value, str):
        return isinstance(authorization, str) and fnmatch.fnmatchcase(value, authorization)
    return type(value) is type(authorization) and value == authorization

def require(condition, message):
    if not condition: raise ValueError(message)

def verify(artifact, platform, source, version, build, output, installer=None, profile_uuid=None):
    artifact = Path(artifact).resolve(strict=True)
    output = Path(output)
    digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
    with tempfile.TemporaryDirectory(prefix='verify-artifact-', dir=output) as temporary:
        temp = Path(temporary)
        if platform == 'ios':
            require(artifact.suffix == '.ipa', 'Expected IPA')
            with zipfile.ZipFile(artifact) as archive:
                require(all(not n.startswith('/') and '..' not in PurePosixPath(n).parts for n in archive.namelist()), 'Unsafe IPA paths')
                archive.extractall(temp)
            apps = list((temp/'Payload').glob('*.app'))
        else:
            require(artifact.suffix == '.pkg' and installer, 'Expected PKG and pinned existing installer identity')
            subprocess.run(['pkgutil','--check-signature',str(artifact)], check=True, capture_output=True)
            toc = temp/'toc.xml'
            subprocess.run(['xar','--dump-toc='+str(toc),'-f',str(artifact)], check=True, capture_output=True)
            require_installer(toc.read_bytes(),installer)
            expanded = temp/'expanded'
            subprocess.run(['pkgutil','--expand-full',str(artifact),str(expanded)], check=True, capture_output=True)
            apps = list(expanded.rglob('*.app'))
        require(len(apps)==1, 'Expected one app only')
        app=apps[0]
        require(not list(app.rglob('*.appex')), 'Unexpected app extension')
        contents=app/'Contents' if platform=='macos' else app
        info=plistlib.loads((contents/'Info.plist').read_bytes())
        require(info.get('CFBundleIdentifier')==BUNDLE, 'Wrong bundle ID')
        require(info.get('CFBundleDisplayName')=='Harmony', 'Wrong display name')
        require(info.get('CFBundleVersion')==build and info.get('CFBundleShortVersionString')==version, 'Wrong bundle version/build')
        require(info.get('ITSAppUsesNonExemptEncryption') is False and info.get('NSMicrophoneUsageDescription'), 'Missing encryption/privacy declaration')
        resources=contents/'Resources' if platform=='macos' else app
        stamp=json.loads((resources/'HarmonyBuildInfo.json').read_text())
        source_root=Path(__file__).resolve().parents[2]
        commit_time=checked_source(source_root,source)
        require(stamp['commit']==source and stamp['commitTime']==commit_time and stamp['dirty'] is False and stamp['event']=='commit', 'Wrong/modified source stamp')
        require(stamp['version']==version and stamp['build']==build, 'Metadata version mismatch')
        # Rebuild expected bytes from the exact checked source, never trust ignored public/www.
        subprocess.run([sys.executable,str(source_root/'mobile/scripts/bundle-web.py')],check=True,capture_output=True)
        expected_web=source_root/'mobile/www'
        manifest=json.loads((expected_web/'native-bundle.json').read_text())
        packaged_web=resources/'public'
        for name,digest in manifest.items():
            require((packaged_web/name).is_file() and hashlib.sha256((packaged_web/name).read_bytes()).hexdigest()==digest,'Packaged web mismatch: '+name)
        require((packaged_web/'native-bundle.json').read_bytes()==(expected_web/'native-bundle.json').read_bytes(),'Wrong packaged web manifest')
        extras={str(p.relative_to(packaged_web)) for p in packaged_web.rglob('*') if p.is_file()}-set(manifest)-{'native-bundle.json','cordova.js','cordova_plugins.js'}
        require(not extras,'Unexpected packaged web assets: '+str(extras))
        config=json.loads((resources/'capacitor.config.json').read_text())
        require(not config.get('server',{}).get('url') and config.get('appId')==BUNDLE,'Remote/wrong native app config')

        require((resources/'PrivacyInfo.xcprivacy').is_file() and (resources/'Assets.car').is_file(), 'Privacy manifest/icon assets missing')
        privacy=plistlib.loads((resources/'PrivacyInfo.xcprivacy').read_bytes())
        require(privacy['NSPrivacyTracking'] is False, 'Unexpected tracking declaration')
        subprocess.run(['codesign','--verify','--deep','--strict',str(app)], check=True, capture_output=True)
        ent=plistlib.loads(subprocess.check_output(['codesign','-d','--entitlements',':-',str(app)], stderr=subprocess.DEVNULL))
        profile_path=contents/('embedded.provisionprofile' if platform=='macos' else 'embedded.mobileprovision')
        profile=plistlib.loads(subprocess.check_output(['security','cms','-D','-i',str(profile_path)], stderr=subprocess.DEVNULL))
        actual_uuid=verify_profile(profile)
        require(profile_uuid is not None and actual_uuid==profile_uuid,'Artifact profile differs from pinned manual profile')
        expiration=profile['ExpirationDate']
        if expiration.tzinfo is None:expiration=expiration.replace(tzinfo=datetime.timezone.utc)
        require(expiration>datetime.datetime.now(datetime.timezone.utc), 'Expired provisioning profile')
        require(profile['TeamIdentifier']==[TEAM], 'Wrong profile team')
        require(not profile.get('ProvisionedDevices') and not profile.get('ProvisionsAllDevices'), 'Device/ad-hoc/enterprise profile rejected')
        authorized=profile['Entitlements']
        for values in (authorized,ent):
            app_id=values.get('application-identifier',values.get('com.apple.application-identifier'))
            require(app_id==TEAM+'.'+BUNDLE and values.get('com.apple.developer.team-identifier')==TEAM, 'Wrong signed app/team identifier')
            require(values.get('get-task-allow') is not True and values.get('com.apple.security.get-task-allow') is not True, 'Debug entitlement present')
        constrained = dict(ent)
        # These two Mac sandbox permissions are app entitlements, not profile
        # capabilities. Permit only these reviewed true values outside the profile.
        if platform == 'macos':
            for key in ('com.apple.security.app-sandbox', 'com.apple.security.personal-information.photos-library'):
                require(constrained.pop(key, None) is True, 'Missing required Mac sandbox entitlement')
        require(allowed(constrained,authorized), 'Signed entitlements exceed profile')
        if platform=='macos':require(ent.get('com.apple.security.app-sandbox') is True and ent.get('com.apple.security.personal-information.photos-library') is True,'Missing Mac sandbox/Photos entitlement')
        prefix=temp/'app-signer-'
        subprocess.run(['codesign','-d','--extract-certificates='+str(prefix),str(app)], check=True, capture_output=True)
        certificate=Path(str(prefix)+'0').read_bytes()
        require(hashlib.sha1(certificate).hexdigest().upper()==DISTRIBUTION and certificate in profile['DeveloperCertificates'], 'App signer does not match existing distribution certificate/profile')
        require(hashlib.sha256(artifact.read_bytes()).hexdigest()==digest, 'Artifact changed during verification')
        result={'artifact':str(artifact),'sha256':digest,'source':source,'platform':platform,'version':version,'build':build,'profileUuid':profile['UUID'],'signature':'verified','existingDistributionCertificateMatched':True,'metadata':stamp,'uploaded':False}
        (output/'artifact-verification.json').write_text(json.dumps(result,indent=2)+'\n')
        return result
