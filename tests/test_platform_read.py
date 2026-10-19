import base64
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

script=Path(__file__).resolve().parents[1] / 'skills/szu-compute-platform/scripts/platform_read.py'
spec=importlib.util.spec_from_file_location('szu_platform_read',script)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
FIXTURE_TOKEN='fixture-only-session-token'

class Response:
    def __init__(self,payload,status=200):self.payload=payload;self.status=status
    def read(self):return json.dumps(self.payload).encode()
    def __enter__(self):return self
    def __exit__(self,*args):return False

class Opener:
    def __init__(self,payloads):self.payloads=iter(payloads);self.requests=[]
    def open(self,request,timeout):
        self.requests.append(request)
        payload=next(self.payloads)
        if isinstance(payload,Exception):raise payload
        return Response(payload)

def ok(data):return {'message':{'code':0},'data':data}

class ReaderTests(unittest.TestCase):
    def test_merges_pages_and_uses_expected_wire_body(self):
        opener=Opener([ok({'list':[{'id':'a1'},{'id':'a2'}],'total':3}),ok({'list':[{'id':'a3'}],'total':3})])
        result=m.query(m.Client(m.DEFAULT_ENDPOINT,FIXTURE_TOKEN,opener=opener),'jobs',cluster='cluster-fixture',page_size=2)
        self.assertEqual([r['id'] for r in result['list']],['a1','a2','a3'])
        self.assertEqual([json.loads(r.data)['pageNum'] for r in opener.requests],[1,2])
        body=json.loads(opener.requests[0].data)
        self.assertEqual(body['clusterId'],'cluster-fixture')
        self.assertEqual(body['jobType'],'training')
        self.assertNotIn('data',body)
        self.assertEqual(dict(opener.requests[0].header_items())['Token'],FIXTURE_TOKEN)

    def test_rejects_inconsistent_or_incomplete_pages(self):
        cases=[
            [ok({'list':[{'id':'a1'}],'total':2}),ok({'list':[{'id':'a1'}],'total':2})],
            [ok({'list':[{'id':'a1'}],'total':2}),ok({'list':[{'id':'a2'}],'total':3})],
            [ok({'list':[{'id':'a1'}],'total':2}),ok({'list':[],'total':2})],
        ]
        for payloads in cases:
            with self.subTest(payloads=payloads),self.assertRaises(m.APIError):
                m.query(m.Client(m.DEFAULT_ENDPOINT,FIXTURE_TOKEN,opener=Opener(payloads)),'jobs',cluster='fixture')

    def test_zero_page_and_page_limit(self):
        result=m.query(m.Client(m.DEFAULT_ENDPOINT,FIXTURE_TOKEN,opener=Opener([ok({'list':[],'total':0})])),'teams')
        self.assertEqual(result,{'list':[],'total':0})
        with self.assertRaises(m.APIError):
            m.query(m.Client(m.DEFAULT_ENDPOINT,FIXTURE_TOKEN,opener=Opener([ok({'list':[{'id':'a1'}],'total':2})])),'teams',max_pages=1)

    def test_business_failure_never_becomes_success(self):
        for payload in [{'message':{'code':500},'data':[]},{'message':{'code':False},'data':[]},{'data':[]},ok(None)]:
            with self.subTest(payload=payload),self.assertRaises(m.APIError):
                m.Client(m.DEFAULT_ENDPOINT,FIXTURE_TOKEN,opener=Opener([payload])).request('POST','/fixture',{})

    def test_redirection_is_not_followed(self):
        handler=m.NoRedirect()
        req=urllib.request.Request(m.DEFAULT_ENDPOINT+'/fixture',headers={'token':FIXTURE_TOKEN})
        self.assertIsNone(handler.redirect_request(req,None,302,'Found',{},'https://example.invalid/login'))
        error=urllib.error.HTTPError(req.full_url,302,'Found',{},None)
        with self.assertRaisesRegex(m.APIError,'HTTP 302'):
            m.Client(m.DEFAULT_ENDPOINT,FIXTURE_TOKEN,opener=Opener([error])).request('GET','/fixture')

    def test_redaction_preserves_nonsecret_metadata(self):
        raw={'pubPassword':FIXTURE_TOKEN,'apiKey':FIXTURE_TOKEN,'accessKey':FIXTURE_TOKEN,'nested':{'token':FIXTURE_TOKEN,'auth':FIXTURE_TOKEN,'cookie':FIXTURE_TOKEN},
             'list':[{'name':'retained','price':1,'url':'https://example.invalid/path?access_token='+FIXTURE_TOKEN}],
             'other_url':'https://user:password@example.invalid/path','callback':'https://example.invalid/callback?ticket='+FIXTURE_TOKEN}
        result=m.sanitise(raw)
        self.assertNotIn(FIXTURE_TOKEN,json.dumps(result))
        self.assertEqual(result['list'][0]['price'],1)
        self.assertEqual(raw['pubPassword'],FIXTURE_TOKEN)

    def test_connection_password_aliases_are_redacted_in_saved_snapshots(self):
        raw = {'vncPwd': FIXTURE_TOKEN, 'passwd': FIXTURE_TOKEN,
               'passphrase': FIXTURE_TOKEN, 'state': 'Running',
               'connectionUrl': 'https://example.invalid/view?pwd=' + FIXTURE_TOKEN}
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / 'connection.json'
            m.write_snapshot(out, raw)
            text = out.read_text(encoding='utf-8')
            self.assertNotIn(FIXTURE_TOKEN, text)
            self.assertEqual(json.loads(text)['state'], 'Running')
        self.assertEqual(raw['vncPwd'], FIXTURE_TOKEN)

    def test_config_and_cli_output_do_not_expose_or_change_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);config=root/'config.json';out=root/'profile.json'
            config.write_text(json.dumps({'auths':{m.DEFAULT_ENDPOINT:{'auth':base64.b64encode(FIXTURE_TOKEN.encode()).decode()}}}),encoding='utf-8')
            before=config.read_bytes()
            self.assertEqual(m.load_token(config,m.DEFAULT_ENDPOINT),FIXTURE_TOKEN)
            stdout=io.StringIO()
            with patch.object(m,'query',return_value={'id':'fixture','pubPassword':FIXTURE_TOKEN}),contextlib.redirect_stdout(stdout):
                m.main(['profile','--config',str(config),'--out',str(out)])
            self.assertNotIn(FIXTURE_TOKEN,stdout.getvalue()+out.read_text(encoding='utf-8'))
            self.assertEqual(config.read_bytes(),before)
            self.assertEqual(list(root.glob('.szu-snapshot-*')),[])
            with contextlib.redirect_stderr(io.StringIO()),self.assertRaises(SystemExit) as error:
                m.main(['profile','--config',str(config),'--out',str(config)])
            self.assertEqual(error.exception.code,2)
            self.assertEqual(config.read_bytes(),before)

    def test_endpoint_and_identifiers_are_checked_before_requests(self):
        for endpoint in ['http://example.invalid','https://user:password@example.invalid','https://example.invalid/path','https://example.invalid?token=x']:
            with self.subTest(endpoint=endpoint),self.assertRaises(m.APIError):m.endpoint_origin(endpoint)
        opener=Opener([]);client=m.Client(m.DEFAULT_ENDPOINT,FIXTURE_TOKEN,opener=opener)
        for command,kwargs in [('job',{'resource_id':'../other'}),('jobs',{})]:
            with self.subTest(command=command),self.assertRaises(m.APIError):m.query(client,command,**kwargs)
        self.assertEqual(opener.requests,[])

if __name__=='__main__':unittest.main(verbosity=2)
