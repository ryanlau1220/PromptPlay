from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, sync_playwright
from pathlib import Path
from urllib.parse import urlparse, parse_qs
import base64, json, os, re, shutil, signal, socket, subprocess, tempfile, time
from urllib.request import Request, build_opener, install_opener, urlopen
from urllib.error import HTTPError, URLError

opener=build_opener();opener.addheaders=[('User-Agent','PromptPlay-Test/1.0')];install_opener(opener)
web=os.environ.get('BROWSER_TEST_WEB_URL','http://localhost:3000').rstrip('/')
api=os.environ.get('BROWSER_TEST_API_URL','http://127.0.0.1:3001').rstrip('/')
extension=Path(os.environ['METEOR_EXTENSION_PATH']).resolve()
ids=[os.environ['TESTNET_PLAYER_A'],os.environ['TESTNET_PLAYER_B']]
assert len(set(ids)) == 2 and all(x.endswith('.testnet') for x in ids)
outcome=os.environ.get('BROWSER_TEST_OUTCOME','win')
if outcome not in ('win','tie'): raise ValueError('BROWSER_TEST_OUTCOME must be win or tie')
profiles=Path(os.environ['METEOR_TEST_PROFILE_DIR']).resolve()
password=Path(os.environ['METEOR_PASSWORD_FILE']).read_text().strip()
if not password: raise ValueError('Wallet password file is empty')
if json.loads((extension/'manifest.json').read_text()).get('version') != '0.8.11': raise ValueError('Meteor Wallet extension 0.8.11 is required')
if any(not (profiles/f'profile-{i}').is_dir() for i in range(2)): raise ValueError('Two existing isolated Meteor profiles are required')
Path('tmp').mkdir(exist_ok=True)
base=Path(tempfile.mkdtemp(prefix='browser-match-',dir='tmp')).resolve();base.chmod(0o700)
trace={'network':'testnet','players':ids,'outcome':outcome,'status':'setup','steps':[], 'transactions':[]}
restart_server=os.environ.get('BROWSER_TEST_RESTART_SERVER')=='true'
redeem=os.environ.get('BROWSER_TEST_REDEEM')=='true'
redemption_rejection=os.environ.get('BROWSER_TEST_REDEMPTION_REJECT')=='true'
push_test=os.environ.get('BROWSER_TEST_PUSH')=='true'
interrupt_verification=os.environ.get('BROWSER_TEST_INTERRUPT_VERIFICATION')=='true'
if redeem and outcome!='win': raise ValueError('Browser redemption requires a winning match')
if redemption_rejection and (not restart_server or redeem): raise ValueError('Redemption rejection requires a test-owned server and cannot be combined with live redemption')
if interrupt_verification and not redeem: raise ValueError('Verification interruption requires browser redemption')
resume=os.environ.get('BROWSER_TEST_RESUME_MATCH','')
if resume and (not resume.isdigit() or int(resume)>2**64-1): raise ValueError('Invalid match ID for resume')
server=None
class RejectionComplete(Exception): pass
def save(step):
 trace['steps'].append(step);(base/'trace.json').write_text(json.dumps(trace,indent=2));print(step,flush=True)
def chain_call(method,params):
 request=Request(os.environ.get('NEAR_RPC_URL','https://archival-rpc.testnet.fastnear.com'),data=json.dumps({'jsonrpc':'2.0','id':1,'method':method,'params':params}).encode(),headers={'content-type':'application/json'})
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
def port_open():
 try:
  with socket.create_connection(('127.0.0.1',3001),timeout=1): return True
 except OSError: return False
def start_server():
 global server
 if port_open(): raise RuntimeError('Port 3001 is in use; stop the existing server before running the restart test')
 with (base/'server.log').open('ab') as log:
  server=subprocess.Popen(['bun','run','dev:server'],stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
 deadline=time.monotonic()+45
 while time.monotonic()<deadline:
  if server.poll() is not None: raise RuntimeError('Test server exited during startup; inspect the server log')
  try:
   with urlopen('http://127.0.0.1:3001/health',timeout=1) as response:
    if json.load(response).get('ok') is True: return
  except (OSError,ValueError): pass
  time.sleep(.2)
 raise RuntimeError('Test server did not become healthy; inspect the server log')
def stop_server():
 global server
 if server is None: return
 if server.poll() is None:
  os.killpg(server.pid,signal.SIGTERM)
  try: server.wait(timeout=10)
  except subprocess.TimeoutExpired:
   os.killpg(server.pid,signal.SIGKILL);server.wait(timeout=5)
 server=None
 deadline=time.monotonic()+10
 while port_open() and time.monotonic()<deadline: time.sleep(.1)
 if port_open(): raise RuntimeError('Port 3001 remained in use after the test server stopped')
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
 return waitfor(lambda:next((q for q in c.pages if q not in previous and q.url.startswith('chrome-extension://') and 'ext_index.html?' in q.url and not q.is_closed()),None),90)
def wallet_prompt(q,accept=True):
 unlock=q.get_by_role('button',name='Unlock',exact=True);approve_button=q.get_by_role('button',name=re.compile(r'^(Approve|Sign|Sign Message)$',re.I))
 unlock.or_(approve_button).first.wait_for(timeout=30000)
 if unlock.is_visible():q.locator('input[type=password]').fill(password);unlock.click()
 (approve_button if accept else q.get_by_role('button',name=re.compile(r'^(Reject|Cancel)$',re.I))).click(timeout=30000)
 waitfor(lambda:q.is_closed(),60)

def sign(c,a,name):
 save('opening '+name)
 previous=set(c.pages)
 a.get_by_role('button',name=name).first.click(timeout=40000)
 wallet_prompt(popup(c,previous))
 a.get_by_text(re.compile(r'^Transaction confirmed(?: on NEAR Testnet\.|\. Match refresh is unavailable)')).first.wait_for(timeout=60000)
 link=a.locator('a[href^="https://testnet.nearblocks.io/txns/"]').last
 link.wait_for(timeout=10000)
 trace['transactions'].append({'step':name,'hash':link.get_attribute('href').rsplit('/',1)[-1]})
 save('confirmed '+name)
contexts=[]
try:
 if redemption_rejection:
  copied_profiles=base/'profiles';copied_profiles.mkdir(mode=0o700)
  shutil.copytree(profiles/'profile-0',copied_profiles/'profile-0',symlinks=True)
  profiles=copied_profiles
  os.environ['DATABASE_PATH']=str(base/'isolated.sqlite')
  os.environ['PROMPTPLAY_FAUCET_ENABLED']='false'
 if restart_server:
  start_server();save('test-owned server started')
 if redeem:
  with urlopen(api+'/config',timeout=10) as response: provider_config=json.load(response)
  if not provider_config.get('redemptionAvailable') or not provider_config.get('redemptionUnitsAvailable') or not all(provider_config.get('capabilities',{}).get(name) for name in ('streaming','toolCalls')): raise RuntimeError('A live redemption provider with available capacity and agent capabilities is required')
  if not shutil.which(os.environ.get('OPENCODE_BIN','opencode')): raise RuntimeError('OpenCode is required; set OPENCODE_BIN')
 if not resume and not redemption_rejection:
  if chain_call('status',[])['chain_id']!='testnet': raise RuntimeError('Configured RPC is not Testnet')
  for i,account in enumerate(ids):
   balance=int(chain_view('token.ryanlau1220.testnet','ft_balance_of',{'account_id':account}))
   required=4_000_000 if redeem and i==0 else 1_000_000
   if balance<required: raise RuntimeError(f'Test player {i} needs at least {required/1_000_000:g} PCC before this run')
 with sync_playwright() as p:
  apps=[]
  for i in range(1 if redemption_rejection else 2):
   c=p.chromium.launch_persistent_context(str(profiles/f'profile-{i}'),channel='chromium',headless=not push_test,ignore_default_args=['--disable-background-networking'] if push_test else None,args=['--no-sandbox',f'--disable-extensions-except={extension}',f'--load-extension={extension}'])
   contexts.append(c);w=c.service_workers[0] if c.service_workers else c.wait_for_event('serviceworker',timeout=20000)
   network=w.evaluate("async()=>JSON.parse((await chrome.storage.local.get('selectedNetwork')).selectedNetwork || 'null')")
   if network!='testnet': raise RuntimeError('Meteor profile must be set to Testnet')
   q=c.new_page();q.set_default_timeout(15000);q.goto('chrome-extension://'+w.url.split('/')[2]+'/ext_index_popup.html');q.wait_for_timeout(1000)
   if q.get_by_role('button',name='Unlock').count():q.locator('input[type=password]').fill(password);q.get_by_role('button',name='Unlock').click()
   try: q.get_by_text(ids[i],exact=True).first.wait_for(timeout=15000)
   except Exception: raise RuntimeError('Meteor profile does not contain the expected account; check the extension path and wallet profile') from None
   a=c.new_page();apps.append(a);a.set_default_timeout(30000);a.goto(web+'/#play',wait_until='domcontentloaded');a.wait_for_timeout(3000)
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
  if redemption_rejection:
   a=apps[0];ca=contexts[0]
   a.evaluate('(key)=>localStorage.removeItem(key)',f'promptplay:redemption:{ids[0]}')
   a.goto(web+'/#redeem',wait_until='domcontentloaded')
   previous=set(ca.pages);a.get_by_role('button',name='Sign NEP-413 Challenge').click(timeout=30000);wallet_prompt(popup(ca,previous))
   with a.expect_response(lambda r:r.url.endswith('/api/redemptions') and r.request.method=='POST' and r.ok) as created:
    a.get_by_role('button',name='Create 1-Unit Intent').click(timeout=30000)
   intent_id=created.value.json()['id'];trace['intentId']=intent_id;save('isolated redemption intent created')
   previous=set(ca.pages);a.get_by_role('button',name='Deposit PCC').click();wallet_prompt(popup(ca,previous),False)
   a.get_by_role('status').get_by_text(re.compile('reject|denied|cancel',re.I)).wait_for(timeout=30000)
   if a.get_by_role('button',name='Deposit PCC').count(): raise RuntimeError('Rejected payment unexpectedly became retryable')
   a.reload(wait_until='domcontentloaded')
   previous=set(ca.pages);a.get_by_role('button',name='Sign NEP-413 Challenge').click(timeout=30000)
   with a.expect_response(lambda r:r.url.endswith('/api/redemptions/'+intent_id) and r.ok) as restored:
    wallet_prompt(popup(ca,previous))
   if not json.loads(a.evaluate('(key)=>localStorage.getItem(key)',f'promptplay:redemption:{ids[0]}')).get('submitted'): raise RuntimeError('Payment attempt was not preserved across reload')
   if a.get_by_role('button',name='Deposit PCC').count(): raise RuntimeError('Payment attempt became retryable after reload')
   a.get_by_text('Check wallet history',exact=False).wait_for(timeout=10000)
   trace['status']='passed';save('rejected payment remained blocked after reload')
   for c in contexts:c.close()
   contexts=[]
   shutil.rmtree(copied_profiles)
   raise RejectionComplete()
  a,b=apps;ca,cb=contexts
  if resume:
   state=chain_view('game2.ryanlau1220.testnet','get_match',{'match_id':resume})
   if not state or state['phase']!='Revealing' or state['round']!=1 or state['stake']!='1000000' or [player['account'] for player in state['players']]!=ids or any(not player['commitment'] or player['revealed'] is not None for player in state['players']): raise RuntimeError('Resume requires the first round with both moves committed and neither revealed')
   match=resume;trace['matchId']=match;save('resuming unrevealed match '+match)
   for page in apps: page.goto(f'{web}/?match={match}#play',wait_until='domcontentloaded')
   for i,page in enumerate(apps):
    key=f'promptplay:testnet:game2.ryanlau1220.testnet:{ids[i]}:{match}:{state["round"]}'
    raw=page.evaluate('(key)=>localStorage.getItem(key)',key)
    if not raw or json.loads(raw).get('choice')!=(0 if i==0 or outcome=='tie' else 2): raise RuntimeError('Saved browser moves do not match the requested outcome; preserve profiles for manual recovery')
  else:
   a.get_by_placeholder('friend.testnet').fill(ids[1]);a.get_by_role('button',name='1 PCC',exact=True).click()
   if os.environ.get('BROWSER_TEST_REJECT_CREATE')=='true':
    save('opening create for rejection')
    previous=set(ca.pages);a.get_by_role('button',name='Create Duel').first.click();wallet_prompt(popup(ca,previous),False)
    status=a.get_by_role('status');status.get_by_text(re.compile('reject|denied|cancel|Wallet did not return a transaction result',re.I)).wait_for(timeout=30000)
    if parse_qs(urlparse(a.url).query).get('match') or a.locator('a[href^="https://testnet.nearblocks.io/txns/"]').count(): raise RuntimeError('Rejected create unexpectedly returned a transaction or match')
    if not a.get_by_role('button',name='Create Duel').first.is_enabled(): raise RuntimeError('Create button did not recover after rejection')
    save('wallet rejection handled')
   sign(ca,a,'Create Duel')
   match=parse_qs(urlparse(a.url).query).get('match',[None])[0]
   if not match or not match.isdigit():raise RuntimeError('Match ID missing after creation')
   trace['matchId']=match;save('created match '+match)
   b.goto(f'{web}/?match={match}#play',wait_until='domcontentloaded')
   sign(ca,a,'Deposit 1 PCC Into Escrow');sign(cb,b,'Deposit 1 PCC Into Escrow')
   if push_test:
    ca.grant_permissions(['notifications'],origin=web)
    previous=set(ca.pages);a.get_by_role('button',name='Notify me').click();wallet_prompt(popup(ca,previous))
    a.get_by_role('button',name='Notifications enabled').wait_for(timeout=60000);save('match push subscribed')
    a.evaluate("async id => {for (const n of await (await navigator.serviceWorker.ready).getNotifications()) if (n.tag === `match-${id}`) n.close()}",match)
   sign(ca,a,'Rock');sign(cb,b,'Rock' if outcome=='tie' else 'Scissors')
  if restart_server:
   save('restarting test-owned server during reveal')
   stop_server();start_server();save('test-owned server restarted')
  a.reload(wait_until='domcontentloaded');save('refreshed before reveal')
  sign(ca,a,'Reveal Secret Move');sign(cb,b,'Reveal Secret Move')
  # A tie advances to another round; the match ends when either player wins twice.
  for _ in range(2 if outcome=='tie' else 1):
   sign(ca,a,'Rock');sign(cb,b,'Scissors')
   sign(ca,a,'Reveal Secret Move');sign(cb,b,'Reveal Secret Move')
  a.get_by_text('Victory!',exact=False).first.wait_for(timeout=30000)
  if push_test:
   waitfor(lambda:a.evaluate("async id => (await (await navigator.serviceWorker.ready).getNotifications()).some(n => n.tag === `match-${id}`)",match),120)
   save('match push delivered')
  sign(ca,a,'Claim 2 PCC Payout')
  def finalized_payout():
   state=chain_view('game2.ryanlau1220.testnet','get_match',{'match_id':match})
   return state if state['id']==match and state['stake']=='1000000' and state['phase']=='Completed' and state['winner']==ids[0] and state['wins']==[2,0] and all(player['claim']=='0' and not player['pending'] for player in state['players']) else None
  state=waitfor(finalized_payout,90)
  if [player['account'] for player in state['players']]!=ids or not all(player['funded'] and player['commitment'] and player['revealed'] is not None for player in state['players']): raise RuntimeError('On-chain players or moves did not match')
  def payout(receipt,recipient,amount):
   if receipt['outcome']['executor_id']!='token.ryanlau1220.testnet' or 'SuccessValue' not in receipt['outcome']['status']: return False
   for line in receipt['outcome']['logs']:
    if not line.startswith('EVENT_JSON:'): continue
    event=json.loads(line[len('EVENT_JSON:'):])
    if event.get('standard')=='nep141' and event.get('event')=='ft_transfer' and any(item.get('old_owner_id')=='game2.ryanlau1220.testnet' and item.get('new_owner_id')==recipient and item.get('amount')==amount for item in event.get('data',[])): return True
   return False
  claims=[item['hash'] for item in trace['transactions'] if item['step']=='Claim 2 PCC Payout']
  recipients=ids[:1]
  if len(claims)!=len(recipients): raise RuntimeError('Missing claim transaction')
  for claim,recipient in zip(claims,recipients):
   tx=chain_call('tx',{'tx_hash':claim,'sender_account_id':recipient,'wait_until':'FINAL'})
   if tx['final_execution_status']!='FINAL' or tx['transaction']['signer_id']!=recipient or tx['transaction']['receiver_id']!='game2.ryanlau1220.testnet' or base64.b64decode(tx['status'].get('SuccessValue','')).decode()!='true': raise RuntimeError('Claim transaction did not complete')
   if not any(payout(receipt,recipient,'2000000') for receipt in tx['receipts_outcome']): raise RuntimeError('Successful PCC payout receipt missing')
  if redeem:
   save('opening browser redemption')
   a.goto(web+'/#redeem',wait_until='domcontentloaded')
   previous=set(ca.pages);a.get_by_role('button',name='Sign NEP-413 Challenge').click(timeout=30000);wallet_prompt(popup(ca,previous))
   previous_redemption=a.get_by_role('button',name='Create another redemption')
   abandoned=a.get_by_role('button',name='Start another',exact=True)
   ready_create=a.get_by_role('button',name='Create 1-Unit Intent').and_(a.locator('button:enabled'))
   previous_redemption.or_(abandoned).or_(ready_create).first.wait_for(timeout=60000)
   if previous_redemption.is_visible(): previous_redemption.click()
   elif abandoned.is_visible(): abandoned.click()
   with a.expect_response(lambda r:r.url.endswith('/api/redemptions') and r.request.method=='POST' and r.ok,timeout=60000):
    a.get_by_role('button',name='Create 1-Unit Intent').click(timeout=30000)
   save('created redemption intent')
   a.get_by_role('button',name='Deposit PCC').wait_for(timeout=60000)
   previous=set(ca.pages);a.get_by_role('button',name='Deposit PCC').click();wallet_prompt(popup(ca,previous))
   for _ in range(30):
    if a.get_by_role('button',name='Authorize and consume').count(): break
    a.get_by_role('button',name='Refresh status').click(timeout=30000);a.wait_for_timeout(2000)
   a.get_by_role('button',name='Authorize and consume').wait_for(timeout=10000)
   failed_verifications=[]
   if interrupt_verification:
    a.on('requestfailed',lambda request:failed_verifications.append(request.url) if '/api/redemptions/' in request.url and request.url.endswith('/claim') else None)
    a.route('**/api/redemptions/*/claim',lambda route:route.abort())
   previous=set(ca.pages);a.get_by_role('button',name='Authorize and consume').click();wallet_prompt(popup(ca,previous))
   if interrupt_verification:
    waitfor(lambda:failed_verifications,90)
    a.unroute('**/api/redemptions/*/claim');save('claim interrupted after escrow consumption')
    a.reload(wait_until='domcontentloaded')
    previous=set(ca.pages);a.get_by_role('button',name='Sign NEP-413 Challenge').click(timeout=30000);wallet_prompt(popup(ca,previous))
    a.get_by_role('button',name='Claim gateway units').click(timeout=30000)
   try:
    a.get_by_role('button',name='Create another redemption').wait_for(timeout=25000)
    save('browser redemption credited automatically')
   except PlaywrightTimeoutError:
    a.get_by_role('button',name='Refresh status').click(timeout=30000)
    a.get_by_role('button',name='Claim gateway units').click(timeout=30000)
    a.get_by_role('button',name='Create another redemption').wait_for(timeout=90000)
    save('browser redemption recovered after refresh')
   saved=json.loads(a.evaluate('(key)=>localStorage.getItem(key)',f'promptplay:redemption:{ids[0]}'))
   trace['redemptionTransaction']=saved.get('hash');save('browser escrow credited')
   with a.expect_response(lambda r:r.url.endswith('/api/keys') and r.request.method=='POST' and r.ok) as created:
    a.get_by_role('button',name='Generate Key').click()
   key_result=created.value.json();gateway_key=key_result['key'];key_id=key_result['id']
   try:
    with a.expect_response(lambda r:r.url.endswith('/api/inference/balance') and r.ok) as balance_response:
     a.get_by_role('button',name='Send Request').click(timeout=30000)
    a.get_by_text('200 OK — Model Response:',exact=False).wait_for(timeout=90000)
    balance_before=balance_response.value.json()['units']
    authorization=balance_response.value.request.headers['authorization']
    replay_request=Request(api+'/api/redemptions/'+saved['id']+'/claim',data=b'{}',headers={'authorization':authorization,'content-type':'application/json'})
    with urlopen(replay_request,timeout=30) as response: replay=json.load(response)
    if replay.get('credited') is not False: raise RuntimeError('Redemption replay did not remain idempotent')
    save('redemption replay did not credit twice')
    save('browser inference completed')
    with urlopen(api+'/config',timeout=10) as response: config=json.load(response)
    executable=os.environ.get('OPENCODE_BIN','opencode')
    with tempfile.TemporaryDirectory(prefix='promptplay-agent-') as folder:
     Path(folder,'marker.txt').write_text('PROMPTPLAY_BROWSER_AGENT_OK\n')
     agent_config={'provider':{'promptplay':{'npm':'@ai-sdk/openai-compatible','name':'PromptPlay','options':{'baseURL':api+'/v1','apiKey':'{env:PROMPTPLAY_API_KEY}'},'models':{config['model']:{'name':config['model'],'limit':{'context':config['contextTokens'],'output':config['maxOutputTokens']},'tool_call':True}}}}}
     env={**os.environ,'INFERENCE_API_KEY':'','PROMPTPLAY_API_KEY':gateway_key,'OPENCODE_CONFIG_CONTENT':json.dumps(agent_config),'OPENCODE_DISABLE_MODELS_FETCH':'true','XDG_CONFIG_HOME':folder+'/config','XDG_DATA_HOME':folder+'/data','XDG_STATE_HOME':folder+'/state','XDG_CACHE_HOME':folder+'/cache'}
     result=subprocess.run([executable,'run','--pure','--auto','--format','json','--dir',folder,'-m','promptplay/'+config['model'],'Read marker.txt using your file tool and reply with its exact content.'],cwd=folder,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=120)
     if result.returncode!=0 or 'PROMPTPLAY_BROWSER_AGENT_OK' not in result.stdout or not re.search(r'tool_use|tool-use|"tool":"read"',result.stdout,re.I): raise RuntimeError('OpenCode gateway file-read check failed')
    with urlopen(Request(api+'/api/inference/balance',headers={'authorization':authorization}),timeout=10) as response: balance_after=json.load(response)['units']
    if balance_after>=balance_before: raise RuntimeError('OpenCode usage did not settle against the allowance')
    trace['allowanceBeforeAgent']=balance_before;trace['allowanceAfterAgent']=balance_after
    save('OpenCode file read completed')
   finally:
    row=a.locator('div').filter(has_text='key_'+key_id[:12]).filter(has=a.locator('button[title="Revoke key"]')).last
    if row.count():
     with a.expect_response(lambda r:r.url.endswith('/api/keys/'+key_id) and r.request.method=='DELETE' and r.ok): row.locator('button[title="Revoke key"]').click()
  trace['status']='passed';save('on-chain payout verified')
  for c in contexts:c.close()
  contexts=[]
except RejectionComplete:
 print('Isolated redemption rejection passed; trace:',base/'trace.json',flush=True)
except Exception as e:
 trace['status']='needs-reconciliation';trace['errorType']=type(e).__name__;save('browser test stopped; inspect match before retrying');print('Trace:',base/'trace.json','; preserve both wallet profiles and inspect chain state before retrying.',flush=True)
 raise
else:
 print('Browser match passed:',trace['matchId'],'trace:',base/'trace.json',flush=True)
finally:
 stop_server()
