"""Validate the exact existing-certificate manual App Store profile in place."""
import datetime
import hashlib
import plistlib
import re
import subprocess
import tempfile
TEAM='JESMXK96LG'
BUNDLE='com.ideaflow.harmony'
DIST='300FAAFC4D696C4B886638DECE3E1319C3D0082E'

def decode_profile(raw):
    with tempfile.NamedTemporaryFile(suffix='.mobileprovision') as file:
        file.write(raw);file.flush()
        return plistlib.loads(subprocess.check_output(['security','cms','-D','-i',file.name],stderr=subprocess.DEVNULL))

def verify_profile(profile):
    expiration=profile['ExpirationDate']
    if expiration.tzinfo is None:expiration=expiration.replace(tzinfo=datetime.timezone.utc)
    ent=profile['Entitlements']
    valid=(expiration>datetime.datetime.now(datetime.timezone.utc) and profile.get('TeamIdentifier')==[TEAM]
           and not profile.get('ProvisionedDevices') and not profile.get('ProvisionsAllDevices')
           and profile.get('IsXcodeManaged',False) is False
           and ent.get('application-identifier',ent.get('com.apple.application-identifier'))==TEAM+'.'+BUNDLE
           and ent.get('com.apple.developer.team-identifier')==TEAM
           and ent.get('get-task-allow') is not True and ent.get('com.apple.security.get-task-allow') is not True
           and [hashlib.sha1(c).hexdigest().upper() for c in profile['DeveloperCertificates']]==[DIST])
    if not valid:raise ValueError('Profile must be exact unexpired unmanaged App Store profile with existing certificate')
    if not re.fullmatch(r'[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}',profile['UUID']):
        raise ValueError('Invalid profile UUID')
    return profile['UUID']

