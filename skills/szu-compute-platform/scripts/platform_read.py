#!/usr/bin/env python3
"""Read-only SZU platform snapshots using local bita auth; Python standard library only."""
import argparse
import base64
import binascii
import json
import os
from pathlib import Path
import re
import tempfile
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_ENDPOINT = 'https://console.aicloud.szu.edu.cn'
ROUTES = {
    'clusters': ('POST', '/gateway/foundation/api/v1/cluster/action/list'),
    'profile': ('GET', '/gateway/ram/api/v1/tenant'),
    'teams': ('POST', '/gateway/order/api/v1/team-user/team-powers/action/page'),
    'resources': ('POST', '/gateway/foundation/api/v1/resource-pool/action/list'),
    'jobs': ('POST', '/gateway/training/api/v1/job/debug/action/page'),
    'images': ('POST', '/gateway/foundation/api/v1/image/action/page'),
    'official-images': ('POST', '/gateway/foundation/api/v1/image/action/official/page'),
    'ssh-keys': ('GET', '/gateway/foundation/api/v1/ssh/action/list'),
    'job': ('GET', '/gateway/training/api/v1/job/debug/{id}'),
    'connection': ('GET', '/gateway/training/api/v1/job/{id}/debug-url'),
    'image': ('GET', '/gateway/foundation/api/v1/image/{id}'),
    'account-status': ('GET', '/gateway/order/api/v1/comp-powers/status/{id}'),
}
PAGED = {'teams', 'jobs', 'images', 'official-images'}
CLUSTER_REQUIRED = {'resources', 'jobs', 'images', 'official-images'}
SECRET_KEY = re.compile(r'token|password|passwd|pwd|passphrase|credential|secret|private.?key|authorization|cookie|signature|api.?key|access.?key|ticket|session.?id|^auth$', re.I)
SECRET_URL = re.compile(r'(?:[?&#])(?:[^=&#]*(?:token|password|passwd|pwd|passphrase|signature|credential|secret|access[_-]?key|api[_-]?key|ticket|cookie)|auth)=', re.I)


class APIError(Exception):
    pass


def endpoint_origin(value):
    parsed = urllib.parse.urlsplit(value)
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username is not None
            or parsed.password is not None or parsed.path not in ('', '/') or parsed.query or parsed.fragment):
        raise APIError('Endpoint must be an HTTPS origin without credentials, path or query.')
    return value.rstrip('/')


def load_token(config_path, endpoint):
    try:
        config = json.loads(config_path.read_text(encoding='utf-8-sig'))
        encoded = config['auths'][endpoint]['auth']
        if not isinstance(encoded, str) or not encoded:
            raise ValueError()
        token = base64.b64decode(encoded, validate=True).decode('utf-8')
        if not token or any(c in token for c in '\r\n'):
            raise ValueError()
        return token
    except (OSError, ValueError, KeyError, TypeError, binascii.Error):
        raise APIError('Local bita authentication is missing or invalid; use the documented login flow.') from None


def sanitise(value, key=''):
    if SECRET_KEY.search(key):
        return '[redacted]'
    if isinstance(value, dict):
        return {k: sanitise(v, str(k)) for k, v in value.items()}
    if isinstance(value, list):
        return [sanitise(v) for v in value]
    if isinstance(value, str):
        if SECRET_URL.search(value):
            return '[redacted URL]'
        if value.startswith(('http://', 'https://')):
            try:
                if urllib.parse.urlsplit(value).username is not None:
                    return '[redacted URL]'
            except ValueError:
                return '[invalid URL]'
    return value


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Client:
    def __init__(self, endpoint, token, direct=False, timeout=30, opener=None):
        self.endpoint = endpoint_origin(endpoint)
        self.token = token
        self.timeout = timeout
        handlers = [NoRedirect()]
        if direct:
            handlers.append(urllib.request.ProxyHandler({}))
        self.opener = opener if opener is not None else urllib.request.build_opener(*handlers)

    def request(self, method, path, body=None):
        encoded = json.dumps(body).encode('utf-8') if method == 'POST' else None
        req = urllib.request.Request(self.endpoint + path, data=encoded, method=method,
                                     headers={'token': self.token, 'Content-Type': 'application/json'})
        try:
            with self.opener.open(req, timeout=self.timeout) as response:
                if not 200 <= response.status < 300:
                    raise APIError('Unexpected HTTP status: ' + str(response.status))
                payload = json.loads(response.read().decode('utf-8'))
        except urllib.error.HTTPError as error:
            raise APIError('HTTP ' + str(error.code) + '; inspect network, authentication or the current API definition.') from None
        except urllib.error.URLError:
            raise APIError('Network request failed; inspect campus access, DNS, proxy and TLS.') from None
        except (UnicodeError, ValueError):
            raise APIError('Expected a JSON API response; no authentication redirects are followed.') from None
        if not isinstance(payload, dict) or not isinstance(payload.get('message'), dict):
            raise APIError('Unexpected API response structure.')
        code = payload['message'].get('code')
        if isinstance(code, bool) or not isinstance(code, int):
            raise APIError('Invalid platform business response code.')
        if code != 0:
            raise APIError('Platform business error code: ' + str(code))
        if payload.get('data') is None:
            raise APIError('Platform returned no data.')
        return payload['data']


def query(client, command, cluster=None, resource_id=None, page_size=50, max_pages=200):
    method, path = ROUTES[command]
    if '{id}' in path:
        if not resource_id or not re.fullmatch(r'[A-Za-z0-9_-]+', resource_id):
            raise APIError('This command requires a valid --id from the current platform response.')
        path = path.replace('{id}', resource_id)
    if command in CLUSTER_REQUIRED and not cluster:
        raise APIError('This command requires --cluster; query clusters first.')
    body = {'clusterId': cluster} if cluster and method == 'POST' and command != 'clusters' else {}
    if command == 'resources':
        body['sceneList'] = ['training']
    if command == 'jobs':
        body.update(jobType='training', jobSubTypes='training-debug,notebook-job,teaching-notebook-job')
    if command not in PAGED:
        return client.request(method, path, body)
    result, seen, expected_total = [], set(), None
    for page in range(1, max_pages + 1):
        data = client.request(method, path, dict(body, pageNum=page, pageSize=page_size))
        if not isinstance(data, dict) or not isinstance(data.get('list'), list):
            raise APIError('Unexpected pagination structure.')
        total = data.get('total')
        if isinstance(total, bool) or not isinstance(total, int) or total < 0:
            raise APIError('Missing or invalid pagination total.')
        if expected_total is None:
            expected_total = total
        elif total != expected_total:
            raise APIError('Pagination total changed; repeat the read-only snapshot.')
        for item in data['list']:
            identifier = item.get('id') if isinstance(item, dict) else None
            if identifier is not None:
                if identifier in seen:
                    raise APIError('Duplicate IDs across pages; repeat the read-only snapshot.')
                seen.add(identifier)
            result.append(item)
        if len(result) == total:
            return {'list': result, 'total': total}
        if not data['list'] or len(result) > total:
            raise APIError('Pagination did not reach the reported total.')
    raise APIError('Pagination limit reached; increase --max-pages after inspecting the response.')


def write_snapshot(path, result):
    text = json.dumps(sanitise(result), indent=2, ensure_ascii=False)
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix='.szu-snapshot-', dir=str(path.parent))
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
            stream.write(text)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=ROUTES)
    parser.add_argument('--cluster')
    parser.add_argument('--id', dest='resource_id', help='Resource ID; account-status requires the current user/profile ID.')
    parser.add_argument('--endpoint', default=DEFAULT_ENDPOINT)
    parser.add_argument('--config', type=Path, default=Path.home() / '.bita' / 'config.json')
    parser.add_argument('--out', type=Path, required=True, help='Sanitised JSON snapshot, never the authentication config.')
    parser.add_argument('--direct', action='store_true', help='Ignore explicit proxy discovery for this API session; does not bypass TUN.')
    parser.add_argument('--page-size', type=int, default=50)
    parser.add_argument('--max-pages', type=int, default=200)
    args = parser.parse_args(argv)
    try:
        if args.page_size < 1 or args.max_pages < 1:
            raise APIError('Pagination limits must be positive.')
        if args.out.resolve() == args.config.resolve():
            raise APIError('Refusing to overwrite authentication configuration.')
        endpoint = endpoint_origin(args.endpoint)
        token = load_token(args.config, endpoint)
        result = query(Client(endpoint, token, direct=args.direct), args.command, args.cluster,
                       args.resource_id, args.page_size, args.max_pages)
        write_snapshot(args.out, result)
        items = result if isinstance(result, list) else result.get('list') if isinstance(result, dict) else None
        print(json.dumps({'command': args.command, 'count': len(items) if isinstance(items, list) else None,
                          'out': str(args.out)}))
    except (APIError, OSError) as error:
        parser.exit(2, 'error: ' + str(error) + '\n')


if __name__ == '__main__':
    main()
