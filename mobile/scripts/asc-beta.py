#!/usr/bin/env python3
"""Scoped Harmony beta metadata/review. Contact stays on Apple host, never printed."""
import argparse, importlib.util,json
from pathlib import Path
import sys
sys.dont_write_bytecode=True
root=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('asc',root/'scripts/asc-internal.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
DESCRIPTION='Sing a melody and hear live in-key harmonies. This iPhone beta uses a native audio session around the same Harmony web engine. Headphones give the clearest result. No account is required. During this beta, microphone audio, app sound and technical readings are sent privately to Ideaflow to help debug after you tap Sing. Turn Recording off to stop sending; Remove deletes recordings. Please read the in-app notice and privacy policy.'
WHAT='Tap Sing and allow microphone access; hold a note and listen for harmonies. Test built-in speaker, wired headphones and AirPods output; report audibility, delay and route changes. In Audio Check, try Continuous harmony ON and watch raw microphone/output meters. Test Stop, backgrounding, phone interruptions and Recording off / Remove. Core harmony works offline; piano backing needs network. Bluetooth microphone is intentionally not used.'
NOTES='No login or demo account is required. Tap Sing, allow microphone, and hold a sung note. The native plugin uses AVAudioSession playAndRecord, defaultToSpeaker and Bluetooth A2DP output, with the built-in microphone. Backgrounding or interruptions stop singing; it never automatically resumes. The beta sends audio and diagnostics privately to Ideaflow as disclosed before singing; Recording off stops sending and Remove deletes recordings. Privacy: https://harmony.jacobcole.net/privacy. No purchase or subscription.'

def upsert(asc,resource,rows,attrs,relationship):
 rows=[x for x in rows if x['attributes'].get('locale')=='en-US']
 if len(rows)>1:raise RuntimeError('Ambiguous localization')
 if rows:
  asc.api('/v1/'+resource+'/'+rows[0]['id'],'PATCH',{'data':{'type':resource,'id':rows[0]['id'],'attributes':attrs}})
 else:asc.api('/v1/'+resource,'POST',{'data':{'type':resource,'attributes':dict(attrs,locale='en-US'),'relationships':relationship}})

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('command',choices=['prepare','submit','status']);p.add_argument('--build-id',required=True);args=p.parse_args()
 if not args.build_id.replace('-','').isalnum():raise RuntimeError('Exact build ID required')
 asc=m.ASC();app=asc.app();aid=app['id'];build=asc.api('/v1/builds/'+args.build_id+'?include=app')['data']
 if build['relationships']['app']['data']['id']!=aid or build['attributes']['processingState']!='VALID' or build['attributes'].get('buildAudienceType')!='APP_STORE_ELIGIBLE':raise RuntimeError('Exact valid external-eligible Harmony build required')
 if args.command=='prepare':
  allowed={'World Issue Tracker','People','Breath Rate Tracker','Box Breathing','Helm','Open Recordings'}
  contact=None;source=None
  for candidate in asc.list('/v1/apps?limit=200'):
   if candidate['attributes']['name'] not in allowed:continue
   try:d=asc.api('/v1/apps/'+candidate['id']+'/betaAppReviewDetail')['data']['attributes']
   except RuntimeError:continue
   keys=['contactFirstName','contactLastName','contactEmail','contactPhone']
   if all(isinstance(d.get(k),str) and d[k].strip() for k in keys):contact={k:d[k] for k in keys};source=candidate['attributes']['name'];break
  if contact is None:raise RuntimeError('No complete approved IdeaFlow beta-review contact found; ask root')
  detail=asc.api('/v1/apps/'+aid+'/betaAppReviewDetail')['data']
  asc.api('/v1/betaAppReviewDetails/'+detail['id'],'PATCH',{'data':{'type':'betaAppReviewDetails','id':detail['id'],'attributes':dict(contact,demoAccountRequired=False,notes=NOTES)}})
  upsert(asc,'betaAppLocalizations',asc.list('/v1/apps/'+aid+'/betaAppLocalizations?limit=200'),{'description':DESCRIPTION,'feedbackEmail':contact['contactEmail'],'privacyPolicyUrl':'https://harmony.jacobcole.net/privacy','marketingUrl':'https://harmony.jacobcole.net/'},{'app':{'data':{'type':'apps','id':aid}}})
  upsert(asc,'betaBuildLocalizations',asc.list('/v1/builds/'+args.build_id+'/betaBuildLocalizations?limit=200'),{'whatsNew':WHAT},{'build':{'data':{'type':'builds','id':args.build_id}}})
  groups=asc.find('betaGroups','app',aid);groups=[g for g in groups if g['attributes']['name']=='Harmony External Beta']
  if not groups:asc.api('/v1/betaGroups','POST',{'data':{'type':'betaGroups','attributes':{'name':'Harmony External Beta','isInternalGroup':False,'publicLinkEnabled':False},'relationships':{'app':{'data':{'type':'apps','id':aid}}}}});groups=[g for g in asc.find('betaGroups','app',aid) if g['attributes']['name']=='Harmony External Beta']
  if len(groups)!=1 or groups[0]['attributes']['isInternalGroup'] or groups[0]['attributes'].get('publicLinkEnabled'):raise RuntimeError('Wrong external group')
  asc.api('/v1/builds/'+args.build_id+'/relationships/betaGroups','POST',{'data':[{'type':'betaGroups','id':groups[0]['id']}]})
  after=asc.api('/v1/apps/'+aid+'/betaAppReviewDetail')['data']['attributes']
  if any(after.get(k)!=v for k,v in contact.items()):raise RuntimeError('Contact readback mismatch')
  local=asc.list('/v1/apps/'+aid+'/betaAppLocalizations?limit=200');local=[x for x in local if x['attributes'].get('locale')=='en-US']
  if len(local)!=1 or local[0]['attributes'].get('feedbackEmail')!=contact['contactEmail'] or local[0]['attributes'].get('privacyPolicyUrl')!='https://harmony.jacobcole.net/privacy':raise RuntimeError('Beta localization readback mismatch')
  linked=asc.list('/v1/builds/'+args.build_id+'/betaGroups')
  if groups[0]['id'] not in [g['id'] for g in linked]:raise RuntimeError('External group attachment readback mismatch')
  print(json.dumps({'prepared':True,'appId':aid,'buildId':args.build_id,'build':build['attributes']['version'],'contactCopiedFrom':source,'contactValuesPrinted':False,'externalGroupId':groups[0]['id'],'publicLink':False,'privacyLabel':'draft, not submitted'}))
 elif args.command=='submit':
  existing=asc.find('betaAppReviewSubmissions','build',args.build_id)
  if not existing:asc.api('/v1/betaAppReviewSubmissions','POST',{'data':{'type':'betaAppReviewSubmissions','relationships':{'build':{'data':{'type':'builds','id':args.build_id}}}}})
  rows=asc.find('betaAppReviewSubmissions','build',args.build_id)
  if len(rows)!=1:raise RuntimeError('Review submission readback not unique')
  print(json.dumps({'buildId':args.build_id,'reviewId':rows[0]['id'],'state':rows[0]['attributes']['betaReviewState']}))
 else:
  rows=asc.find('betaAppReviewSubmissions','build',args.build_id)
  print(json.dumps({'appId':aid,'buildId':args.build_id,'build':build['attributes']['version'],'processingState':build['attributes']['processingState'],'reviews':[{'id':x['id'],'state':x['attributes']['betaReviewState']} for x in rows]}))
if __name__=='__main__':main()
