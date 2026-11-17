#!/usr/bin/env python3
"""Manually archive/export/validate Harmony under the shared M5 lease and Aqua.
Export only by default. --upload sends the identical verified internal-only artifact.
Run after native/design gates; ASC website record remains a separate owner step.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import re
import subprocess
import sys
sys.dont_write_bytecode = True
from release_source import checked_source, child_env
from provision_profile import decode_profile, verify_profile
from altool_output import require_altool_success

TEAM='JESMXK96LG'
DIST='300FAAFC4D696C4B886638DECE3E1319C3D0082E'
AGENT='a2ff6ce3-4151-447a-b664-27cf52146cad'

def manual_archive_settings(profile_uuid,build):
    # Resolve the profile only in the application target. A command-line
    # PROVISIONING_PROFILE_SPECIFIER also reaches profile-free Swift packages.
    return ['CODE_SIGNING_ALLOWED=YES','CODE_SIGN_STYLE=Manual',
            'DEVELOPMENT_TEAM='+TEAM,'CODE_SIGN_IDENTITY='+DIST,
            'HARMONY_APP_STORE_PROFILE='+profile_uuid,
            'CURRENT_PROJECT_VERSION='+build,'MARKETING_VERSION=0.1.0']

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--platform',choices=['ios','macos'],required=True)
    parser.add_argument('--source',required=True)
    parser.add_argument('--build',required=True)
    parser.add_argument('--installer-sha')
    parser.add_argument('--profile-path',type=Path,required=True)
    parser.add_argument('--upload',action='store_true')
    args=parser.parse_args()
    if not re.fullmatch('[0-9a-f]{40}',args.source) or not re.fullmatch('[0-9]+',args.build):parser.error('Full source SHA and numeric build required')
    root=Path(__file__).resolve().parents[1];os.chdir(root)
    process_env=child_env()
    # Apple rsync must find its own server, never Homebrew's incompatible binary.
    process_env['PATH']='/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/Users/jacobcole/.local/bin'
    if subprocess.check_output(['uname','-s'],text=True).strip()!='Darwin':raise RuntimeError('Apple host required')
    if subprocess.check_output(['launchctl','managername'],text=True).strip()!='Aqua':raise RuntimeError('Task-owned gui/501 Aqua job required')
    owner=json.loads((Path.home()/'.local/state/ios-build-slot.lock.d/owner.json').read_text())
    if owner.get('agentId')!=AGENT or owner.get('project')!='harmony':raise RuntimeError('Own Harmony build lease required')
    checked_source(root.parent,args.source)
    identities=subprocess.check_output(['security','find-identity','-v','-p','codesigning'],text=True)
    if DIST not in identities:raise RuntimeError('Pinned existing Distribution identity required; no creation')
    profile=decode_profile(args.profile_path.resolve(strict=True).read_bytes())
    profile_uuid=verify_profile(profile)
    expected_platform='iOS' if args.platform=='ios' else 'OSX'
    if expected_platform not in profile.get('Platform',[]):raise RuntimeError('Profile platform mismatch')
    if args.platform=='macos':
        basic=subprocess.check_output(['security','find-identity','-v','-p','basic'],text=True)
        if not args.installer_sha or not re.fullmatch('[A-Fa-f0-9]{40}',args.installer_sha) or args.installer_sha.upper() not in basic:raise RuntimeError('Exact existing valid Mac Installer identity required')
    key=Path.home()/'.appstoreconnect/private_keys/AuthKey_KWJX4896S5.p8'
    issuer=(Path.home()/'.appstoreconnect/issuer_id').read_text().strip()
    if not key.is_file():raise RuntimeError('Established host-local ASC key required')
    output=root/'build'/('testflight-'+args.source+'-'+args.platform+'-'+args.build)
    output.mkdir(parents=True,exist_ok=False)
    receipt={'source':args.source,'version':'0.1.0','build':args.build,'platform':args.platform,'internalOnly':False,'stage':'starting','profileUuid':profile_uuid,'signingMode':'manual-existing-certificate'}
    def save(): (output/'release.json').write_text(json.dumps(receipt,indent=2)+'\n')
    save()
    def run(arguments,name,verified_artifact=None):
        with (output/(name+'.log')).open('w') as log:subprocess.run(arguments,env=process_env,stdout=log,stderr=subprocess.STDOUT,check=True,timeout=1800)
        if name in ('validate','upload'):
            if verified_artifact is None:raise RuntimeError('Exact verified artifact required for altool checks')
            require_altool_success((output/(name+'.log')).read_text(),name,verified_artifact)
        print(name,'PASS',flush=True)
    run(['npm','run','bundle'],'bundle-web')
    run(['npx','--no-install','cap','copy','ios'],'copy-web')
    run([sys.executable,str(root/'scripts/write-stamp.py'),args.source,args.build],'source-stamp')
    archive=output/'Harmony.xcarchive'
    destination='generic/platform=iOS' if args.platform=='ios' else 'generic/platform=macOS'
    run(['xcodebuild','-workspace','ios/App/App.xcworkspace','-scheme','App','-configuration','Release','-destination',destination,'-archivePath',str(archive),'-derivedDataPath',str(output/'DerivedData'),*manual_archive_settings(profile_uuid,args.build),'archive'],'archive')
    export={'method':'app-store-connect','teamID':TEAM,'signingStyle':'manual','provisioningProfiles':{'com.ideaflow.harmony':profile_uuid},'signingCertificate':DIST,'manageAppVersionAndBuildNumber':False,'uploadSymbols':True,'destination':'export','testFlightInternalTestingOnly':False}
    if args.platform=='macos':export['installerSigningCertificate']=args.installer_sha.upper()
    options=output/'ExportOptions.plist';options.write_bytes(plistlib.dumps(export))
    run(['xcodebuild','-exportArchive','-archivePath',str(archive),'-exportPath',str(output/'export'),'-exportOptionsPlist',str(options)],'export')
    artifacts=list((output/'export').glob('*.ipa' if args.platform=='ios' else '*.pkg'))
    if len(artifacts)!=1:raise RuntimeError('Expected one exact platform export artifact')
    spec=importlib.util.spec_from_file_location('verify_distribution',root/'scripts/verify-distribution.py')
    verify=importlib.util.module_from_spec(spec);spec.loader.exec_module(verify)
    verified=verify.verify(artifacts[0],args.platform,args.source,'0.1.0',args.build,output,args.installer_sha,profile_uuid)
    receipt.update(stage='verified, not uploaded',artifact=verified['artifact'],sha256=verified['sha256']);save()
    artifact=Path(verified['artifact'])
    api_auth=['--apiKey','KWJX4896S5','--apiIssuer',issuer]
    run(['xcrun','altool','--validate-app','-f',str(artifact),'-t','ios' if args.platform=='ios' else 'macos',*api_auth],'validate',artifact)
    receipt.update(stage='verified and Apple-validated, not uploaded',appleValidation='PASS');save()
    if not args.upload:print('Verified export only; upload not requested');return
    if hashlib.sha256(artifact.read_bytes()).hexdigest()!=verified['sha256']:raise RuntimeError('Verified artifact changed before upload')
    run(['xcrun','altool','--upload-app','-f',str(artifact),'-t','ios' if args.platform=='ios' else 'macos',*api_auth],'upload',artifact)
    receipt.update(stage='upload accepted; processing/group pending');save()
    print('UPLOAD ACCEPTED; verify VALID, APP_STORE_ELIGIBLE and group membership separately',flush=True)

if __name__=='__main__':main()
