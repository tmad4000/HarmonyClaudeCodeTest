#!/usr/bin/env python3
"""Create/reuse one unmanaged App Store profile/platform with the existing cert.
Authorized only after native/Fable/release-tool gates. No cert/key/ID creation.
All profile/key material stays on the Apple host. Default shows the plan only.
"""
import argparse
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
sys.dont_write_bytecode = True
from provision_profile import decode_profile, verify_profile

TEAM='JESMXK96LG'
BUNDLE='com.ideaflow.harmony'
DIST='300FAAFC4D696C4B886638DECE3E1319C3D0082E'

def prepare(platform,root):
    spec=importlib.util.spec_from_file_location('asc_internal',root/'scripts/asc-internal.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);asc=module.ASC()
    bundles=asc.find('bundleIds','identifier',BUNDLE)
    if len(bundles)!=1 or bundles[0]['attributes']['identifier']!=BUNDLE:raise RuntimeError('Exact pre-registered bundle required')
    bundle_id=bundles[0]['id']
    certificate=[c for c in asc.list('/v1/certificates?limit=200') if hashlib.sha1(base64.b64decode(c['attributes']['certificateContent'])).hexdigest().upper()==DIST]
    if len(certificate)!=1:raise RuntimeError('Existing distribution public certificate not unique')
    certificate_id=certificate[0]['id']
    profile_type='IOS_APP_STORE' if platform=='ios' else 'MAC_APP_STORE'
    profiles=[p for p in asc.list('/v1/bundleIds/'+bundle_id+'/profiles?limit=200') if p['attributes']['profileType']==profile_type]
    if len(profiles)>1:raise RuntimeError('More than one platform App Store profile; inspect before any mutation')
    created=False
    if not profiles:
        # This is the sole authorized creation: one profile with one EXISTING cert.
        response=asc.api('/v1/profiles','POST',{'data':{'type':'profiles','attributes':{
            'name':'Harmony '+('iOS' if platform=='ios' else 'Mac')+' App Store','profileType':profile_type},
            'relationships':{'bundleId':{'data':{'type':'bundleIds','id':bundle_id}},
                             'certificates':{'data':[{'type':'certificates','id':certificate_id}]}}}})
        profiles=[response['data']];created=True
    profile_id=profiles[0]['id']
    response=asc.api('/v1/profiles/'+profile_id+'?include=bundleId,certificates')['data']
    if response['attributes']['profileType']!=profile_type or response['attributes']['profileState']!='ACTIVE':raise RuntimeError('Wrong/inactive profile')
    relations=response['relationships']
    if relations['bundleId']['data']['id']!=bundle_id or relations['certificates']['data']!=[{'type':'certificates','id':certificate_id}]:raise RuntimeError('Wrong profile binding')
    raw=base64.b64decode(response['attributes']['profileContent'])
    profile=decode_profile(raw);uuid=verify_profile(profile)
    if uuid!=response['attributes']['uuid']:raise RuntimeError('CMS/API profile UUID mismatch')
    after=[p for p in asc.list('/v1/bundleIds/'+bundle_id+'/profiles?limit=200') if p['attributes']['profileType']==profile_type]
    if len(after)!=1 or after[0]['id']!=profile_id:raise RuntimeError('Platform profile count/readback mismatch')
    install=Path.home()/'Library/Developer/Xcode/UserData/Provisioning Profiles'
    install.mkdir(parents=True,exist_ok=True)
    path=install/(uuid+('.mobileprovision' if platform=='ios' else '.provisionprofile'))
    if path.exists() and path.read_bytes()!=raw:raise RuntimeError('Existing installed UUID has different bytes; stop')
    path.write_bytes(raw);path.chmod(0o600)
    verify_profile(decode_profile(path.read_bytes()))
    result={'platform':platform,'profileType':profile_type,'profileId':profile_id,'uuid':uuid,'created':created,
            'bundle':BUNDLE,'certificateSha1':DIST,'installedPath':str(path),'profileSha256':hashlib.sha256(raw).hexdigest()}
    folder=root/'build/profiles';folder.mkdir(parents=True,exist_ok=True)
    (folder/(platform+'.json')).write_text(json.dumps(result,indent=2)+'\n')
    return result

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--platform',choices=['ios','macos'],required=True)
    parser.add_argument('--create-or-reuse',action='store_true')
    args=parser.parse_args()
    if not args.create_or_reuse:
        print('PLAN ONLY: one '+args.platform+' App Store profile, com.ideaflow.harmony, existing Distribution cert. No account request.')
        return
    if subprocess.check_output(['uname','-s'],text=True).strip()!='Darwin':raise RuntimeError('Existing authorized Apple host only')
    print(json.dumps(prepare(args.platform,Path(__file__).resolve().parents[1]),indent=2))

if __name__=='__main__':main()
