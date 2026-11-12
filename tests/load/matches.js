import http from 'k6/http';
import ws from 'k6/ws';
import crypto from 'k6/crypto';
import { check,fail } from 'k6';
import { Rate,Trend,Counter } from 'k6/metrics';

const requestedMatches=Number(__ENV.MATCHES||0);
export const options={setupTimeout:'3m',scenarios:{shootouts:requestedMatches?{executor:'per-vu-iterations',vus:requestedMatches*2,iterations:1,maxDuration:'3m'}:{executor:'constant-vus',vus:Number(__ENV.VUS||10),duration:__ENV.DURATION||'1m',gracefulStop:'3m'}},thresholds:{match_success:['rate>0.95'],match_duration:['p(95)<150000'],http_req_failed:['rate<0.01'],command_errors:['count==0']}};
const success=new Rate('match_success'),duration=new Trend('match_duration',true);
const endpoints=(__ENV.API_URLS||__ENV.API_URL||'http://localhost:3001').split(',');
const zones=['left','centre','right'];
const commandErrors=new Counter('command_errors');
export function setup(){
  for(const endpoint of endpoints){
    const response=http.get(`${endpoint}/health`,{timeout:'10s',tags:{phase:'readiness'}});
    let healthy=false;
    if(response.status===200){try{healthy=response.json().ok===true;}catch{}}
    if(!healthy)fail(`API not ready at ${endpoint}; wait for healthy services before starting load`);
  }
  if(requestedMatches){
    const requests=Array.from({length:requestedMatches*2},(_,i)=>({method:'POST',url:endpoints[i%endpoints.length]+'/session',body:'{}',params:{headers:{'Content-Type':'application/json'}}}));
    const replies=http.batch(requests);
    const players=replies.map(r=>{if(r.status!==201)fail('Load fixture session creation failed: '+r.status);return r.json();});
    return {players,queueAt:Date.now()+5000,playAt:Date.now()+25000};
  }
}
function hex(buffer){return Array.from(new Uint8Array(buffer),n=>n.toString(16).padStart(2,'0')).join('');}
// k6 implements the small Engine.IO v4 / Socket.IO event envelope here. No npm adapter.
export default function(data){
  commandErrors.add(0);
  const schedule=data;
  const base=endpoints[(__VU-1)%endpoints.length];
  const res=data?.players?null:http.post(`${base}/session`,'{}',{headers:{'Content-Type':'application/json'}});
  if(res&&!check(res,{'guest created':r=>r.status===201})){success.add(false);return;}
  const user=data?.players?data.players[__VU-1]:res.json(),started=Date.now();let completed=false,version=-1,matchId='',seq=0;const pending={},secrets={};
  const response=ws.connect(`${base.replace(/^http/,'ws')}/socket.io/?EIO=4&transport=websocket`,{},socket=>{
    function emit(event,data,callback){const id=seq++;if(callback)pending[id]=callback;socket.send(`42${id}${JSON.stringify([event,data])}`);}
    let deferred;
    if(data?.playAt)socket.setTimeout(()=>{if(deferred){act(deferred);deferred=undefined;}},Math.max(1,data.playAt-Date.now()));
    function snapshot(s){
      if(s.id!==matchId){matchId=s.id;version=-1;}
      if(s.version<=version)return;version=s.version;
      if(data?.playAt&&Date.now()<data.playAt){deferred=s;return;}
      act(s);
    }
    function act(s){
      if(s.phase==='SETTLED'){
        const wallet=http.get(`${base}/me`,{headers:{Authorization:`Bearer ${user.token}`}}).json();
        const expected=100000-s.stake+(s.winner===user.id?s.payout:0);
        completed=check(wallet,{'wallet equals settled payout':w=>w.balance===expected});duration.add(Date.now()-started);socket.close();return;
      }
      if(s.phase.endsWith('_COMMIT')&&!s.committed.includes(user.id)&&!secrets[s.exchange]){
        const choice=zones[Math.floor(Math.random()*3)],salt=hex(crypto.randomBytes(32));secrets[s.exchange]={choice,salt};
        const hash=crypto.sha256(JSON.stringify([s.id,Math.floor(s.exchange/2)+1,s.exchange,user.id,choice,salt]),'hex');
        emit('choice:commit',{matchId:s.id,exchange:s.exchange,hash},r=>{if(r.ok)snapshot(r.data);});
      }
      if(s.phase.endsWith('_REVEAL')&&!s.revealed.includes(user.id)&&secrets[s.exchange]&&!secrets[s.exchange].sent){
        const secret=secrets[s.exchange];secret.sent=true;
        emit('choice:reveal',{matchId:s.id,exchange:s.exchange,choice:secret.choice,salt:secret.salt},r=>{if(r.ok)snapshot(r.data);});
      }
    }
    socket.on('message',message=>{
      if(message==='2'){socket.send('3');return;}
      if(message[0]==='0'){socket.send(`40${JSON.stringify({token:user.token})}`);return;}
      if(message.startsWith('43')){const bracket=message.indexOf('['),id=message.slice(2,bracket),data=JSON.parse(message.slice(bracket));if(data[0]?.ok===false)commandErrors.add(1);if(pending[id]){pending[id](data[0]);delete pending[id];}return;}
      if(!message.startsWith('42'))return;
      const [event,data]=JSON.parse(message.slice(message.indexOf('[')));
      if(event==='ready'){const queue=()=>emit('queue:join',{stake:1000});if(schedule?.queueAt)socket.setTimeout(queue,Math.max(1,schedule.queueAt-Date.now()));else queue();}
      if(event==='account'&&data.matchId)emit('match:join',{id:data.matchId},r=>{if(r.ok)snapshot(r.data);});
      if(event==='match')snapshot(data);
    });
    socket.setInterval(()=>emit('heartbeat',{}),5000);
    socket.setTimeout(()=>socket.close(),150000);
  });
  check(response,{'websocket upgrade':r=>r&&r.status===101});success.add(completed);
}
