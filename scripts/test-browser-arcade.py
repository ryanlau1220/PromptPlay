from playwright.sync_api import sync_playwright
from pathlib import Path
from urllib.parse import urlparse, parse_qs
import base64, json, os, re, tempfile, time
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

extension=Path(os.environ['METEOR_EXTENSION_PATH']).resolve()
ids=[os.environ['TESTNET_PLAYER_A'],os.environ['TESTNET_PLAYER_B']]
assert len(set(ids)) == 2 and all(x.endswith('.testnet') for x in ids)
profiles=Path(os.environ['METEOR_TEST_PROFILE_DIR']).resolve()
password=Path(os.environ['METEOR_PASSWORD_FILE']).read_text().strip()
if not password: raise ValueError('Wallet password file is empty')
if json.loads((extension/'manifest.json').read_text()).get('version') != '0.8.11': raise ValueError('Meteor Wallet extension 0.8.11 is required')
if any(not (profiles/f'profile-{i}').is_dir() for i in range(2)): raise ValueError('Two existing isolated Meteor profiles are required')
Path('tmp').mkdir(exist_ok=True)
base=Path(tempfile.mkdtemp(prefix='browser-match-',dir='tmp')).resolve();base.chmod(0o700)
trace={'network':'testnet','players':ids,'outcome':'tie','status':'setup','steps':[], 'transactions':[]}
def save(step):
 trace['steps'].append(step);(base/'trace.json').write_text(json.dumps(trace,indent=2));print(step,flush=True)
def chain_call(method,params):
 request=Request(os.environ.get('NEAR_RPC_URL','https://archival-rpc.testnet.near.org'),data=json.dumps({'jsonrpc':'2.0','id':1,'method':method,'params':params}).encode(),headers={'content-type':'application/json'})
 for attempt in range(4):
  try:
   with urlopen(request,timeout=30) as response: result=json.load(response)
   break
  except HTTPError as error:
   if attempt==3 or error.code not in (429,500,502,503,504): raise
  except (URLError,TimeoutError):
   if attempt==3: raise
  time.sleep(2**attempt)
 if 'error' in result: raise RuntimeError('Testnet RPC failed verification')
 return result['result']
def chain_view(contract,method,args):
 query=chain_call('query',{'request_type':'call_function','finality':'final','account_id':contract,'method_name':method,'args_base64':base64.b64encode(json.dumps(args).encode()).decode()})
 return json.loads(bytes(query['result']))
def waitfor(fn,timeout=30):
 end=time.monotonic()+timeout
 while time.monotonic()<end:
  try:
   result=fn()
   if result:return result
  except Exception:pass
  apps[0].wait_for_timeout(200)
 raise RuntimeError('Timed out waiting for browser state')
def popup(c,previous):
 return waitfor(lambda:next((q for q in c.pages if q not in previous and q.url.startswith('chrome-extension://') and 'ext_index.html?' in q.url and not q.is_closed()),None))
def wallet_prompt(q,accept=True):
 unlock=q.get_by_role('button',name='Unlock',exact=True);approve_button=q.get_by_role('button',name=re.compile(r'^(Approve|Sign|Sign Message)$',re.I))
 unlock.or_(approve_button).first.wait_for(timeout=30000)
 if unlock.is_visible():q.locator('input[type=password]').fill(password);unlock.click()
 (approve_button if accept else q.get_by_role('button',name=re.compile(r'^(Reject|Cancel)$',re.I))).click(timeout=30000)
 waitfor(lambda:q.is_closed(),60)

contexts=[]
try:
 if chain_call('status',[])['chain_id']!='testnet': raise RuntimeError('Configured RPC is not Testnet')
 for account in ids:
  balance=int(chain_view('token.ryanlau1220.testnet','ft_balance_of',{'account_id':account}))
  if balance<1_000_000: raise RuntimeError('Each test player needs at least 1 PCC')
 with sync_playwright() as p:
  apps=[]
  for i in range(2):
   c=p.chromium.launch_persistent_context(str(profiles/f'profile-{i}'),channel='chromium',headless=True,args=['--no-sandbox',f'--disable-extensions-except={extension}',f'--load-extension={extension}'])
   contexts.append(c);w=c.service_workers[0] if c.service_workers else c.wait_for_event('serviceworker',timeout=20000)
   network=w.evaluate("async()=>JSON.parse((await chrome.storage.local.get('selectedNetwork')).selectedNetwork || 'null')")
   if network!='testnet': raise RuntimeError('Meteor profile must be set to Testnet')
   q=c.new_page();q.set_default_timeout(15000);q.goto('chrome-extension://'+w.url.split('/')[2]+'/ext_index_popup.html');q.wait_for_timeout(1000)
   if q.get_by_role('button',name='Unlock').count():q.locator('input[type=password]').fill(password);q.get_by_role('button',name='Unlock').click()
   try: q.get_by_text(ids[i],exact=True).first.wait_for(timeout=15000)
   except Exception: raise RuntimeError('Meteor profile does not contain the expected account; check the extension path and wallet profile') from None
   a=c.new_page();apps.append(a);a.set_default_timeout(30000);a.goto('http://localhost:3000/#play',wait_until='domcontentloaded');a.wait_for_timeout(3000)
   if ids[i] not in a.locator('header').inner_text():
    a.get_by_role('button',name='Connect Wallet',exact=True).first.click()
    a.get_by_text('Meteor Wallet',exact=True).click()
    frame=waitfor(lambda:next((f for f in a.frames if f.get_by_role('button',name='Chrome Extension').count()),None))
    previous=set(c.pages)
    frame.get_by_role('button',name='Chrome Extension').click()
    v=popup(c,previous)
    unlock=v.get_by_role('button',name='Unlock',exact=True);connect=v.get_by_role('button',name='Connect',exact=True)
    unlock.or_(connect).first.wait_for(timeout=30000)
    if unlock.is_visible():v.locator('input[type=password]').fill(password);unlock.click()
    connect.click(timeout=30000)
   a.locator('header').get_by_text(ids[i]).wait_for(timeout=30000)
   save(f'wallet {i} connected')
  a,b=apps;ca,cb=contexts
  def sign_arcade(context,page,label):
   save('opening '+label)
   previous=set(context.pages);page.get_by_role('button',name=label,exact=True).first.click(timeout=40000);wallet_prompt(popup(context,previous))
   page.get_by_role('status').get_by_text('Transaction confirmed.',exact=False).wait_for(timeout=90000)
   link=page.locator('a[href^="https://testnet.nearblocks.io/txns/"]').last;link.wait_for(timeout=10000)
   trace['transactions'].append({'step':label,'hash':link.get_attribute('href').rsplit('/',1)[-1]});save('confirmed '+label)
  match=os.environ.get('ARCADE_TEST_RESUME_MATCH','')
  if match:
   state=chain_view('arcade.ryanlau1220.testnet','get_match',{'match_id':match})
   if not state or state['phase']!='Funding' or [p['account'] for p in state['players']]!=ids or any(p['funded'] for p in state['players']):raise RuntimeError('Resume requires this pair in a fresh unfunded match')
   trace['matchId']=match;save('resuming verified unfunded shared match '+match)
   a.goto(f'http://localhost:3000/#arcade-duel?match={match}',wait_until='domcontentloaded')
  else:
   a.goto('http://localhost:3000/#arcade-duel?game=tic-tac-toe',wait_until='domcontentloaded')
   a.get_by_placeholder('friend.testnet').fill(ids[1])
   sign_arcade(ca,a,'Create match')
   match=parse_qs(urlparse(a.url).fragment.partition('?')[2]).get('match',[None])[0]
   if not match or not match.isdigit():raise RuntimeError('Match ID unavailable after creation')
   trace['matchId']=match;save('created shared match '+match)
  b.goto(f'http://localhost:3000/#arcade-duel?match={match}',wait_until='domcontentloaded')
  sign_arcade(ca,a,'Deposit 1 PCC');sign_arcade(cb,b,'Deposit 1 PCC')
  sign_arcade(ca,a,'Agree tie');sign_arcade(cb,b,'Agree tie')
  sign_arcade(ca,a,'Claim 1 PCC');sign_arcade(cb,b,'Claim 1 PCC')
  state=chain_view('arcade.ryanlau1220.testnet','get_match',{'match_id':match})
  if state['phase']!='Completed' or state['outcome']!='Tie' or [p['account'] for p in state['players']]!=ids or any(p['claim']!='0' or p['pending'] for p in state['players']):raise RuntimeError('Final on-chain settlement state mismatch')
  for item,recipient in zip(trace['transactions'][-2:],ids):
   tx=chain_call('tx',{'tx_hash':item['hash'],'sender_account_id':recipient,'wait_until':'FINAL'})
   if tx['final_execution_status']!='FINAL' or tx['transaction']['receiver_id']!='arcade.ryanlau1220.testnet' or base64.b64decode(tx['status'].get('SuccessValue','')).decode()!='true':raise RuntimeError('Payout transaction failed')
   transfer=False
   for receipt in tx['receipts_outcome']:
    if receipt['outcome']['executor_id']!='token.ryanlau1220.testnet' or 'SuccessValue' not in receipt['outcome']['status']:continue
    for line in receipt['outcome']['logs']:
     if not line.startswith('EVENT_JSON:'):continue
     event=json.loads(line[len('EVENT_JSON:'):])
     if event.get('standard')=='nep141' and event.get('event')=='ft_transfer' and any(row.get('old_owner_id')=='arcade.ryanlau1220.testnet' and row.get('new_owner_id')==recipient and row.get('amount')=='1000000' for row in event.get('data',[])):transfer=True
   if not transfer:raise RuntimeError('PCC payout receipt missing')
  trace['status']='passed';save('shared settlement and payout verified')
  print('Trace:',base/'trace.json',flush=True)
  for c in contexts:c.close()
  contexts=[]
except Exception as e:
 trace['status']='needs-reconciliation';trace['errorType']=type(e).__name__;save('browser test stopped; inspect match before retrying');print('Trace:',base/'trace.json',flush=True);raise
finally:
 for c in contexts:
  try:c.close()
  except Exception:pass
