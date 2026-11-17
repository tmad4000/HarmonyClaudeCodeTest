#!/usr/bin/env python3
"""Host-local ASC operations for Harmony. Default is read-only status.
Uses the existing M5 PyJWT installation/key in place; never copies key material.
No certificate/profile/key creation, external groups, review or public submission.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import time
import urllib.error
import urllib.parse
import urllib.request

BUNDLE = 'com.ideaflow.harmony'
DISTRIBUTION = '300FAAFC4D696C4B886638DECE3E1319C3D0082E'
BASE = 'https://api.appstoreconnect.apple.com'

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

class ASC:
    def __init__(self):
        import jwt  # Existing Apple-host release tooling, not an app dependency.
        self.jwt = jwt
        self.key = Path.home() / '.appstoreconnect/private_keys/AuthKey_KWJX4896S5.p8'
        self.issuer = (Path.home() / '.appstoreconnect/issuer_id').read_text().strip()
        if not self.key.is_file():
            raise RuntimeError('Established in-place ASC key unavailable; stop for owner')
        self.opener = urllib.request.build_opener(NoRedirect())
        certificates = self.list('/v1/certificates?limit=200')
        if not any(hashlib.sha1(base64.b64decode(x['attributes']['certificateContent'])).hexdigest().upper()
                   == DISTRIBUTION for x in certificates):
            raise RuntimeError('Existing team distribution certificate not visible to this key')

    def api(self, path, method='GET', data=None):
        url = path if path.startswith('https:') else BASE + path
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme != 'https' or parsed.netloc != 'api.appstoreconnect.apple.com':
            raise RuntimeError('Unexpected ASC endpoint')
        now = int(time.time())
        token = self.jwt.encode({'iss': self.issuer, 'iat': now, 'exp': now + 600,
                                 'aud': 'appstoreconnect-v1'}, self.key.read_text(),
                                algorithm='ES256', headers={'kid': 'KWJX4896S5', 'typ': 'JWT'})
        request = urllib.request.Request(url, method=method,
            headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'},
            data=None if data is None else json.dumps(data).encode())
        try:
            with self.opener.open(request, timeout=45) as response:
                raw = response.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as error:
            try:
                codes = [str(x.get('code', '')) for x in json.loads(error.read()).get('errors', [])]
            except (ValueError, KeyError, TypeError):
                codes = []
            raise RuntimeError('ASC HTTP ' + str(error.code) + ' ' + ','.join(codes)) from None

    def list(self, path):
        rows = []
        while path:
            page = self.api(path)
            rows.extend(page['data'])
            path = page.get('links', {}).get('next')
        return rows

    def find(self, resource, filter_key, value):
        return self.list('/v1/' + resource + '?' + urllib.parse.urlencode({
            'filter[' + filter_key + ']': value, 'limit': 200}))

    def app(self):
        apps = self.find('apps', 'bundleId', BUNDLE)
        if len(apps) != 1 or apps[0]['attributes']['name'] != 'Harmony by Ideaflow':
            raise RuntimeError('Exact Harmony ASC app record unavailable; website owner required')
        return apps[0]

    def register(self):
        matches = self.find('bundleIds', 'identifier', BUNDLE)
        if not matches:
            self.api('/v1/bundleIds', 'POST', {'data': {'type': 'bundleIds', 'attributes': {
                'name': 'Harmony', 'identifier': BUNDLE, 'platform': 'UNIVERSAL'}}})
            matches = self.find('bundleIds', 'identifier', BUNDLE)
        if len(matches) != 1 or matches[0]['attributes']['identifier'] != BUNDLE:
            raise RuntimeError('Bundle registration readback mismatch')
        return {'bundleId': BUNDLE, 'id': matches[0]['id'],
                'platform': matches[0]['attributes']['platform']}

    def groups_for_build(self, build_id):
        # Apple supports this include; the related /builds/{id}/betaGroups GET is forbidden.
        response=self.api('/v1/builds/'+urllib.parse.quote(build_id,safe='')+'?include=betaGroups')
        relation=response['data']['relationships']['betaGroups']
        links=relation['data']
        if relation.get('meta',{}).get('paging',{}).get('total',len(links))!=len(links):
            raise RuntimeError('Build group linkage is truncated; inspect before mutation')
        ids={g['id'] for g in links}
        groups=[g for g in response.get('included',[]) if g['type']=='betaGroups' and g['id'] in ids]
        if len(groups)!=len(ids):raise RuntimeError('Build group include incomplete')
        return groups

    def internal(self, build_id):
        app = self.app()
        response = self.api('/v1/builds/' + urllib.parse.quote(build_id, safe='') + '?include=preReleaseVersion,app')
        build = response['data']
        if build['relationships']['app']['data']['id'] != app['id']:
            raise RuntimeError('Build belongs to another app')
        attrs = build['attributes']
        if attrs['processingState'] != 'VALID' or attrs.get('buildAudienceType') != 'APP_STORE_ELIGIBLE':
            raise RuntimeError('Build must be VALID and APP_STORE_ELIGIBLE before attaching')
        existing = self.groups_for_build(build_id)
        if any(not x['attributes']['isInternalGroup'] or x['attributes'].get('publicLinkEnabled') for x in existing):
            raise RuntimeError('Unexpected external/public group on this build')
        groups = self.find('betaGroups', 'app', app['id'])
        internal = [g for g in groups if g['attributes']['name'] == 'Internal Testers'
                    and g['attributes']['isInternalGroup'] and not g['attributes'].get('publicLinkEnabled')]
        if not internal:
            if any(g['attributes']['name'] == 'Internal Testers' for g in groups):
                raise RuntimeError('Conflicting group name; no mutation')
            self.api('/v1/betaGroups', 'POST', {'data': {'type': 'betaGroups', 'attributes': {
                'name': 'Internal Testers', 'isInternalGroup': True, 'publicLinkEnabled': False},
                'relationships': {'app': {'data': {'type': 'apps', 'id': app['id']}}}}})
            groups = self.find('betaGroups', 'app', app['id'])
            internal = [g for g in groups if g['attributes']['name'] == 'Internal Testers'
                        and g['attributes']['isInternalGroup'] and not g['attributes'].get('publicLinkEnabled')]
        if len(internal) != 1:
            raise RuntimeError('Canonical internal group not unique')
        group = internal[0]
        self.api('/v1/builds/' + build_id + '/relationships/betaGroups', 'POST',
                 {'data': [{'type': 'betaGroups', 'id': group['id']}]})
        linked = self.groups_for_build(build_id)
        if group['id'] not in [g['id'] for g in linked] or any(
                not g['attributes']['isInternalGroup'] or g['attributes'].get('publicLinkEnabled') for g in linked):
            raise RuntimeError('Internal-only group readback failed')
        return {'buildId': build_id, 'build': attrs['version'], 'processingState': 'VALID',
                'audience': 'APP_STORE_ELIGIBLE', 'groups': [g['attributes']['name'] for g in linked]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['status', 'register-bundle', 'attach-internal'], nargs='?', default='status')
    parser.add_argument('--build-id')
    args = parser.parse_args()
    asc = ASC()
    if args.command == 'register-bundle':
        result = asc.register()
    elif args.command == 'attach-internal':
        if not args.build_id or not args.build_id.replace('-', '').isalnum():
            parser.error('Exact build-id required')
        result = asc.internal(args.build_id)
    else:
        apps = asc.find('apps', 'bundleId', BUNDLE)
        result = {'bundleIds': [{'id': x['id'], 'identifier': x['attributes']['identifier'],
                               'platform': x['attributes']['platform']} for x in asc.find('bundleIds', 'identifier', BUNDLE)],
                  'apps': [{'id': x['id'], 'name': x['attributes']['name'],
                            'bundleId': x['attributes']['bundleId']} for x in apps]}
        if len(apps) == 1:
            result['builds'] = [{'id': x['id'], 'build': x['attributes']['version'],
                                'processingState': x['attributes']['processingState'],
                                'audience': x['attributes'].get('buildAudienceType')}
                               for x in asc.find('builds', 'app', apps[0]['id'])]
    print(json.dumps(result, indent=2))

if __name__ == '__main__':
    main()
