from playwright.sync_api import sync_playwright
from pathlib import Path
from urllib.parse import urlparse, parse_qs
import json, os, tempfile, time
from urllib.request import Request, urlopen

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
trace={'network':'testnet','players':ids,'status':'setup','steps':[], 'transactions':[]}
def save(step):
 trace['steps'].append(step);(base/'trace.json').write_text(json.dumps(trace,indent=2));print(step,flush=True)
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
def approve(q):
 unlock=q.get_by_role('button',name='Unlock',exact=True);approve_button=q.get_by_role('button',name='Approve',exact=True)
 unlock.or_(approve_button).first.wait_for(timeout=30000)
 if unlock.is_visible():q.locator('input[type=password]').fill(password);unlock.click()
 approve_button.click(timeout=30000)
 waitfor(lambda:q.is_closed(),60)

def sign(c,a,name):
 save('opening '+name)
 previous=set(c.pages)
 a.get_by_role('button',name=name).first.click(timeout=40000)
 approve(popup(c,previous))
 a.get_by_text('Transaction confirmed on NEAR Testnet!').first.wait_for(timeout=60000)
 link=a.locator('a[href^="https://testnet.nearblocks.io/txns/"]').last
 link.wait_for(timeout=10000)
 trace['transactions'].append({'step':name,'hash':link.get_attribute('href').rsplit('/',1)[-1]})
 save('confirmed '+name)
contexts=[]
try:
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
  a.get_by_placeholder('friend.testnet').fill(ids[1]);a.get_by_role('button',name='1 PCC',exact=True).click();sign(ca,a,'Create Duel')
  match=parse_qs(urlparse(a.url).query).get('match',[None])[0]
  if not match or not match.isdigit():raise RuntimeError('Match ID missing after creation')
  trace['matchId']=match;save('created match '+match)
  b.goto(f'http://localhost:3000/?match={match}#play',wait_until='domcontentloaded')
  sign(ca,a,'Deposit 1 PCC Into Escrow');sign(cb,b,'Deposit 1 PCC Into Escrow')
  sign(ca,a,'Rock');sign(cb,b,'Scissors')
  a.reload(wait_until='domcontentloaded');save('refreshed before reveal')
  sign(ca,a,'Reveal Secret Move');sign(cb,b,'Reveal Secret Move');sign(ca,a,'Claim 2 PCC Payout')
  a.get_by_text('Victory!',exact=False).first.wait_for(timeout=30000)
  rpc=os.environ.get('NEAR_RPC_URL','https://archival-rpc.testnet.near.org')
  def call(method,params):
   request=Request(rpc,data=json.dumps({'jsonrpc':'2.0','id':1,'method':method,'params':params}).encode(),headers={'content-type':'application/json'})
   with urlopen(request,timeout=30) as response: result=json.load(response)
   if 'error' in result: raise RuntimeError('Testnet RPC failed verification')
   return result['result']
  import base64
  query=call('query',{'request_type':'call_function','finality':'final','account_id':'game.ryanlau1220.testnet','method_name':'get_match','args_base64':base64.b64encode(json.dumps({'match_id':match}).encode()).decode()})
  state=json.loads(bytes(query['result']))
  if state['id']!=match or state['stake']!='1000000' or state['phase']!='Completed' or state['winner']!=ids[0] or any(player['claim']!='0' or player['pending'] for player in state['players']): raise RuntimeError('Final on-chain match state did not match the browser result')
  if [player['account'] for player in state['players']]!=ids or not all(player['funded'] and player['commitment'] and player['revealed'] is not None for player in state['players']): raise RuntimeError('On-chain players or moves did not match')
  claim=next(item['hash'] for item in trace['transactions'] if item['step']=='Claim 2 PCC Payout')
  tx=call('tx',{'tx_hash':claim,'sender_account_id':ids[0],'wait_until':'FINAL'})
  if tx['final_execution_status']!='FINAL' or tx['transaction']['signer_id']!=ids[0] or tx['transaction']['receiver_id']!='game.ryanlau1220.testnet' or base64.b64decode(tx['status'].get('SuccessValue','')).decode()!='true': raise RuntimeError('Claim transaction did not complete')
  def payout(receipt):
   if receipt['outcome']['executor_id']!='token.ryanlau1220.testnet' or 'SuccessValue' not in receipt['outcome']['status']: return False
   for line in receipt['outcome']['logs']:
    if not line.startswith('EVENT_JSON:'): continue
    event=json.loads(line[len('EVENT_JSON:'):])
    if event.get('standard')=='nep141' and event.get('event')=='ft_transfer' and any(item.get('old_owner_id')=='game.ryanlau1220.testnet' and item.get('new_owner_id')==ids[0] and item.get('amount')=='2000000' for item in event.get('data',[])): return True
   return False
  if not any(payout(receipt) for receipt in tx['receipts_outcome']): raise RuntimeError('Successful PCC payout receipt missing')
  trace['status']='passed';save('on-chain payout verified')
  for c in contexts:c.close()
  contexts=[]
except Exception as e:
 trace['status']='needs-reconciliation';trace['errorType']=type(e).__name__;save('browser test stopped; inspect match before retrying');print('Trace:',base/'trace.json','; preserve both wallet profiles and inspect chain state before retrying.',flush=True)
 raise
else:
 print('Browser match passed:',trace['matchId'],'trace:',base/'trace.json',flush=True)
