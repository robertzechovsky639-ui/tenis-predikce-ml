'use strict';
const $=s=>document.querySelector(s), esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const S={view:'zapasy',day:0,circ:'all',filt:'all',favOnly:false,data:{},fav:new Set(JSON.parse(localStorage.fav||'[]')),favP:new Set(JSON.parse(localStorage.favP||'[]')),detail:null,tab:'prehled',status:{},lat:[]};
const DN=['Neděle','Pondělí','Úterý','Středa','Čtvrtek','Pátek','Sobota'];
const pct=x=>x==null?'–':Math.round(x*100)+' %', f2=x=>x==null?'–':(+x).toFixed(2);
const initials=n=>(n||'?').replace(/[^\p{L} ]/gu,'').split(' ').filter(Boolean).map(w=>w[0]).slice(0,2).join('').toUpperCase();
const shortN=p=>{const n=p.name||'';if(/\s\w\.$/.test(n))return n; const t=n.split(' ');return t.length>1?t[0][0]+'. '+t.slice(1).join(' '):n};
const surfCz={Hard:'Tvrdý',Clay:'Antuka',Grass:'Tráva',Carpet:'Koberec'};
const tagOf=c=>c==='ATP'?['ATP','atp']:c==='WTA'?['WTA','wta']:c==='Challenger'?['CH','']:c==='WTA 125'?['125','wta']:c.startsWith('ITF')?['ITF','itf']:[c,''];
async function api(u){if(STATIC)return staticApi(u);const r=await fetch(u);if(!r.ok)throw new Error(r.status);return r.json()}
function saveFav(){localStorage.fav=JSON.stringify([...S.fav]);localStorage.favP=JSON.stringify([...S.favP])}
const isFav=m=>S.fav.has(m.id)||(m.pids||[]).some(p=>p&&S.favP.has(p));

let _st0=null;async function load(day){if(STATIC){if(!_st0&&cacheLoad()){for(let d=-2;d<=2;d++)S.data[d]=ST.all.filter(m=>m.day===d);render();upd()}_st0=_st0||loadStatic();await _st0}const d=await api('/api/matches?day='+day);S.data[day]=d.matches;S.status=d.status;render();upd()}
function upd(){const s=S.status||{};let html;if(STATIC){const lv=ST.all.filter(m=>m.status==='live').length;s.live=lv;const H={sofascore:'Sofascore',s365:'365scores',espn:'ESPN',sofaDetail:'detail'};const hd=health().map(h=>`<span class="hd ${h.state}" title="${H[h.k]}">${H[h.k]}</span>`).join('');
  const age=ST.generated?Math.round((Date.now()/1000-ST.generated)/60):null;
  html=`<span class="g"></span>${lv?lv+' živě':'Bez živých zápasů'} · predikce aktualizovány před ${age??'–'} min<div class="hrow">${hd}</div>`;}
 else{const l=S.lat.length?` · zpoždění push ${Math.round(S.lat.at(-1))} ms`:'';
  html=(s.demo?'<span class="tag demo">DEMO</span> ':'<span class="g"></span>')+`${s.live?'Živě':'Bez živých zápasů'} · aktualizováno ${s.last_poll?new Date(s.last_poll).toLocaleTimeString('cs-CZ'):'–'}${l}`;}
 const el=$('#upd');if(el&&el._h!==html){el._h=html;el.innerHTML=html}}

// ---- SSE: okamžité aktualizace ----
function stream(){if(STATIC)return staticLoop();const es=new EventSource('/api/stream');
 es.onmessage=e=>{const m=JSON.parse(e.data);if(m.status)S.status=m.status;
  if(m.type==='update'){S.lat.push(Date.now()-m.t_push*1000);for(const x of m.matches){const arr=S.data[x.day]||(S.data[x.day]=[]);const i=arr.findIndex(y=>y.id===x.id);if(i>=0)arr[i]=x;else arr.push(x)}
   api('/api/status').then(s=>{S.status=s;upd()});if(S.view==='zapasy'||S.view==='oblibene')paintList(m.matches.map(x=>x.id));
   if(S.detail&&m.matches.some(x=>x.id===S.detail.id)){const x=m.matches.find(z=>z.id===S.detail.id);const sig=scoreSig(x);if(S.detail._lsig!==sig){S.detail=x;S.detail._lsig=sig;drawDetail()}}}
  upd()};}

function filt(list){return list.filter(m=>{
 if(S.circ!=='all'){if(S.circ==='CH'){if(!['Challenger','WTA 125'].includes(m.circuit))return false}else if(m.circuit!==S.circ)return false}
 if(S.filt==='live'&&m.status!=='live')return false;if(S.filt==='up'&&m.status!=='upcoming')return false;if(S.filt==='fin'&&m.status!=='finished')return false;
 if(S.filt==='value'&&!m.value)return false;if(S.filt==='qual'&&!m.qual)return false;if(S.filt==='main'&&m.qual)return false;
 if(S.favOnly&&!isFav(m))return false;return true})}

function scoreSig(m){const p=m.live?m.live.match:m.pred;return [m.status,JSON.stringify(m.sets),JSON.stringify(m.pts_raw||m.pts),m.server||0,m.winner||0,p==null?'':Math.round(p*100),m.pred_low?1:0,m.odds?(m.odds.best_a+','+m.odds.best_b):'',m.value||''].join('|')}
function shownSets(m){return TenisLive.displaySets(m.sets,m.status,m.best_of)}
function structSig(m){return [m.status,shownSets(m).length,m.pts_raw?1:0,m.pred!=null?1:0,m.odds?1:0,m.winner||0,m.server||0].join('|')}
function visKey(){if(S.view==='oblibene')return 'f:'+Object.values(S.data).flat().filter(isFav).map(m=>m.id).join(',');if(S.view!=='zapasy')return 'v:'+S.view;return [S.day,S.circ,S.filt,S.favOnly?1:0,(filt(S.data[S.day]||[])).map(m=>m.id).join(',')].join('|')}
function curSetIdx(m){const s=shownSets(m);return m.status==='live'&&s.length&&!TenisLive.finishedSet(s[s.length-1])?s.length-1:-1}
function patchCard(el,m){const rows=el.querySelectorAll('.row');if(rows.length<2)return false;const curK=curSetIdx(m);const sets=shownSets(m);
 for(let i=0;i<2;i++){const box=rows[i].querySelector('.sc');if(!box){if(sets.length)return false;continue}
  const spans=box.querySelectorAll('span');let k=m.server===i+1?1:0;if(spans.length<k+sets.length+(m.pts_raw?1:0))return false;
  for(let s=0;s<sets.length;s++,k++){const t=String(sets[s][i]);const cur=s===curK;if(spans[k].textContent!==t){spans[k].textContent=t;spans[k].className=cur?'cur flash':'';}}
  if(m.pts_raw){const raw=m.pts_raw[i];const t=(raw==50||raw==='A')?'A':String(raw);if(spans[k].textContent!==t){spans[k].textContent=t;spans[k].className='cur flash';}}}
 const p=m.live?m.live.match:m.pred;const bar=el.querySelector('.bar');
 if(p!=null&&bar){const bs=bar.querySelectorAll('span');const a=pct(p),b=pct(1-p);if(bs[0]&&bs[0].textContent!==a)bs[0].textContent=a;if(bs[1]&&bs[1].textContent!==b)bs[1].textContent=b;const bi=bar.querySelector('i');if(bi)bi.style.width=(p*100)+'%';}
 const lb=el.querySelector('.lbl');if(lb){const want=`${m.live?'PREDIKCE TEĎ':'PREDIKCE MODELU'}${m.pred_low?' <span class="low">nízká spolehlivost</span>':''}`;if(lb.innerHTML!==want)lb.innerHTML=want;}
 el.dataset.sig=scoreSig(m);return true}
function syncCard(el,m){const sig=scoreSig(m);if(el.dataset.sig===sig)return;
 if(el.dataset.st===structSig(m)&&patchCard(el,m))return;
 const tmp=document.createElement('div');tmp.innerHTML=card(m);const n=tmp.firstChild;if(!n)return;
 const os=[...el.querySelectorAll('.sc span')].map(x=>x.textContent);[...n.querySelectorAll('.sc span')].forEach((x,i)=>{if(os[i]!==undefined&&os[i]!==x.textContent)x.classList.add('flash')});n.onclick=()=>openDetail(m.id);el.replaceWith(n)}
let _pq=null,_raf=0;
function paintList(ids){if(!ids||!ids.length)return;if(!_pq)_pq=new Set();for(const id of ids)_pq.add(id);if(_raf)return;
 const run=()=>{_raf=0;const q=_pq;_pq=null;paintListNow([...q]);};
 _raf=(window.requestAnimationFrame||(f=>setTimeout(f,16)))(run);}
function paintListNow(ids){const k=visKey();if(k!==S.vis){render();return}for(const id of ids||[]){const el=document.querySelector(`.m[data-id="${CSS.escape(id)}"]`);const m=(typeof ST!=='undefined'&&ST.byId&&ST.byId[id])||Object.values(S.data).flat().find(x=>x.id===id);if(el&&m)syncCard(el,m)}}
function card(m){const fin=m.status==='finished',live=m.status==='live',curK=curSetIdx(m),sets=shownSets(m);
 const sc=i=>sets.map((s,k)=>`<span class="${k===curK?'cur':''}">${s[i]}</span>`).join('');
 const t=new Date(m.ts*1000).toLocaleTimeString('cs-CZ',{timeZone:'Europe/Prague',hour:'2-digit',minute:'2-digit'});
 const p=m.live?m.live.match:m.pred;
 const pl=(i)=>`<div class="row"><div class="pl ${m.winner===i+1?'w':''}"><span class="flag">${esc((m.players[i].country||'').slice(0,3).toUpperCase())}</span>${esc(shortN(m.players[i]))}${!m.pids[i]?' <span class="na">(bez historie)</span>':''}</div>
   ${sets.length?`<div class="sc">${m.server===i+1?'<span style="color:#ffc84a">●</span>':''}${sc(i)}${m.pts_raw?`<span class="cur">${m.pts_raw[i]==50?'A':m.pts_raw[i]}</span>`:''}</div>`:i===0?`<div class="time">${t}</div>`:''}${i===0&&live?' <span class="livebadge">▶ živě</span>':''}</div>`;
 let h=`<div class="m" data-id="${esc(m.id)}" data-st="${esc(structSig(m))}" data-sig="${esc(scoreSig(m))}">${pl(0)}${pl(1)}`;
 if(p!=null)h+=`<div class="lbl">${m.live?'PREDIKCE TEĎ':'PREDIKCE MODELU'}${m.pred_low?' <span class="low">nízká spolehlivost</span>':''}</div><div class="bar"><span>${pct(p)}</span><div class="t"><i style="width:${p*100}%"></i></div><span>${pct(1-p)}</span></div>`;
 else h+=`<div class="na" style="margin-top:6px">Predikce nedostupná – hráč není v historických datech</div>`;
 if(m.odds)h+=`<div class="odds"><span class="ob ${m.value==='A'?'val':''}">${f2(m.odds.best_a)}${m.value==='A'?' ▲':''}</span><span>nejlepší kurz <b class="pa">${f2(m.odds.best_a)}</b> : <b class="pb">${f2(m.odds.best_b)}</b> · ${m.odds.n}×</span><span class="ob ${m.value==='B'?'val':''}">${f2(m.odds.best_b)}${m.value==='B'?' ▲':''}</span></div>`;
 else if(!fin)h+=`<div class="odds"><span class="na">kurzy nedostupné</span></div>`;
 return h+'</div>'}

function matchesView(fav){let h='';
 if(!fav){h+=`<h1>ZÁPASY <span class="pill">● ${(S.data[0]||[]).filter(m=>m.status==='live').length} živě</span></h1><div class="days">`;
  for(let d=-2;d<=2;d++){const x=TenisLive.pragueDate(d);const n=d===0?'Dnes':d===-1?'Včera':d===1?'Zítra':DN[x.wd];
   h+=`<button data-day="${d}" class="${d===S.day?'on':''}"><b>${n}</b><small>${x.d}. ${x.m}.</small></button>`}
  h+=`</div><div class="filters"><div class="sel"><label>OKRUHY</label><select id="circ">${[['all','Všechny okruhy'],['ATP','ATP'],['WTA','WTA'],['CH','Challenger / WTA 125'],['ITF muži','ITF muži'],['ITF ženy','ITF ženy']].map(([v,t])=>`<option value="${v}" ${S.circ===v?'selected':''}>${t}</option>`).join('')}</select></div>
  <div class="sel"><label>FILTR</label><select id="filt">${[['all','Vše'],['live','Živě'],['up','Nadcházející'],['fin','Dokončené'],['value','Value'],['qual','Kvalifikace'],['main','Hlavní soutěž']].map(([v,t])=>`<option value="${v}" ${S.filt===v?'selected':''}>${t}</option>`).join('')}</select></div>
  <button class="star ${S.favOnly?'on':''}" id="favt">${S.favOnly?'★':'☆'}</button></div>`}
 else h+=`<h1>OBLÍBENÉ</h1><div class="notif"><button class="ob" id="nbtn">🔔 Upozornění na oblíbené</button> <span class="na">začátek, set, konec, velký zvrat šancí (≥ 15 b.)</span></div>`;
 const all=fav?Object.values(S.data).flat().filter(isFav):filt(S.data[S.day]||[]);
 if(!all.length)return h+`<div class="empty">${S.data[S.day]?'Žádné zápasy pro zvolený filtr.':'Načítám…'}${fav?'<br>Hvězdičkou v detailu zápasu přidáš oblíbený zápas, v záložce Hráči oblíbeného hráče (jeho zápasy se tu pak ukážou samy).':''}</div>`;
 const g={};for(const m of all){const k=m.circuit+'|'+m.tournament+'|'+m.qual;(g[k]=g[k]||[]).push(m)}
 for(const k in g){const m=g[k][0],[tg,cl]=tagOf(m.circuit);
  h+=`<div class="grp"><div class="ghead"><div>${esc(m.tournament)}<small>${esc(m.circuit)} · ${surfCz[m.surface]||m.surface}${m.qual?' · Kvalifikace':''} · zdroj ${m.src}</small></div><div>${m.demo?'<span class="tag demo">DEMO</span>':''}<span class="tag ${cl}">${tg}</span>${m.qual?'<span class="tag q">Q</span>':''}</div></div>${g[k].map(card).join('')}</div>`}
 return h}

async function predView(){return `<h1>PREDIKCE</h1><div class="box"><h3>VLASTNÍ ZÁPAS</h3><input class="q" id="pa" placeholder="Hráč A (např. Lehečka)"><div id="pal"></div><br><input class="q" id="pb" placeholder="Hráč B"><div id="pbl"></div><br>
 <div class="seg" id="psurf">${['Hard','Clay','Grass'].map((s,i)=>`<button data-s="${s}" class="${i?'':'on'}">${surfCz[s]}</button>`).join('')}</div><div id="pres"></div></div>
 <div class="box"><h3>VALUE TIPY DNES</h3>${(S.data[0]||[]).filter(m=>m.value).map(card).join('')||'<div class="note">Žádné value tipy (nebo chybí kurzy).</div>'}</div>`}
async function modelView(){const m=await api('/api/model');const r=(k,n)=>`<tr><td>${n}</td><td>${(m.test[k].accuracy*100).toFixed(2)} %</td><td>${m.test[k].log_loss.toFixed(4)}</td><td>${m.test[k].brier.toFixed(4)}</td></tr>`;
 return `<h1>MODEL</h1><div class="box"><h3>TESTOVACÍ METRIKY (${esc(m.split)})</h3><table><tr><th></th><th>PŘESNOST</th><th>LOG LOSS</th><th>BRIER</th></tr>${r('lightgbm','LightGBM')}${r('logreg','Log. regrese')}${r('elo','Elo (baseline)')}${r('rank','Žebříček (baseline)')}</table>
 <p class="note">Testovaných zápasů: ${m.test_rows.toLocaleString('cs-CZ')} · trénink: ${m.train_rows.toLocaleString('cs-CZ')} · data ${m.data_from} až ${m.data_to} (${m.n_matches.toLocaleString('cs-CZ')} zápasů, Jeff Sackmann) · iterací ${m.gbm_iterations} · natrénováno ${m.trained_at}</p></div>
 <div class="box"><h3>PRŮBĚŽNÉ UČENÍ</h3><p class="note">${m.incremental?`Při posledním exportu započteno ${m.incremental.applied} dohraných zápasů do Elo, formy a H2H.`:''} Stromy LightGBM se mezi dny nemění. Denně se celý model přetrénuje a publikuje jen, když na holdoutu (posledních 8 týdnů) porazí Elo a není výrazně horší než minule publikovaný.</p>
 ${(m.history||[]).length?`<table><tr><th>DATUM</th><th>HOLDOUT</th><th>NOVÝ</th><th>STARÝ</th><th></th></tr>${m.history.slice(-10).reverse().map(h=>`<tr><td>${h.at.slice(0,10)}</td><td>${h.holdout_n}</td><td>${h.candidate.log_loss.toFixed(4)}</td><td>${h.current.log_loss.toFixed(4)}</td><td>${h.published?'✅':'↩︎'}</td></tr>`).join('')}</table><p class="note">Log loss na holdoutu; ✅ = publikováno, ↩︎ = ponechán starý model.</p>`:'<p class="note">Zatím žádné přetrénování.</p>'}</div>
 ${m.calibration?`<div class="box"><h3>KALIBRACE NA TESTU (Brier ${m.test.lightgbm.brier.toFixed(4)})</h3><table><tr><th>PŘEDPOVĚĎ</th><th>N</th><th>PRŮMĚR</th><th>SKUTEČNOST</th></tr>${m.calibration.map(b=>`<tr><td>${Math.round(b.lo*100)}–${Math.round(b.hi*100)} %</td><td>${b.n}</td><td>${(b.pred*100).toFixed(1)} %</td><td>${(b.real*100).toFixed(1)} %</td></tr>`).join('')}</table></div>`:''}
 <div class="box"><h3>PODLE OKRUHU (LightGBM vs Elo)</h3><table><tr><th></th><th>N</th><th>LGBM</th><th>ELO</th></tr>${Object.entries(m.by_circuit).map(([c,v])=>`<tr><td>${c}</td><td>${v.lightgbm.n}</td><td>${(v.lightgbm.accuracy*100).toFixed(1)} %</td><td>${(v.elo.accuracy*100).toFixed(1)} %</td></tr>`).join('')}</table></div>
 <div class="box"><h3>DŮLEŽITOST PŘÍZNAKŮ (gain)</h3>${Object.entries(m.importance).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<div class="bar" style="margin:5px 0"><span style="width:90px">${k}</span><div class="t" style="background:#2a2060"><i style="width:${v*100}%"></i></div><span>${(v*100).toFixed(1)} %</span></div>`).join('')}</div>
 ${STATIC?`<div class="box"><h3>ŽIVÁ DATA (GitHub Pages)</h3><p class="note">Skóre přímo z prohlížeče: na počítači Sofascore 1,5 s, 365scores 2,5 s a ESPN 4 s (začátky rozložené, ať se tři odpovědi nesejdou najednou); na telefonu 2,2 / 5 / 8 s. Detail bod po bodu jen u zápasů na obrazovce. JSON se čte mimo hlavní vlákno. Při chybě se interval zdvojnásobuje až na 30 s, na pozadí nejméně 15 s. Odezva zdrojů (medián): ${Object.entries(SOURCES).map(([k,s])=>k+' '+(s.lat&&s.lat.length?Math.round([...s.lat].sort((a,b)=>a-b)[s.lat.length>>1]):'–')+' ms').join(', ')}. Předzápasové predikce: GitHub Actions, vygenerováno ${new Date(ST.generated*1000).toLocaleString('cs-CZ')}.</p></div>`:''}<div class="box" style="${STATIC?'display:none':''}"><h3>ŽIVÁ DATA</h3><p class="note">Poslední dotaz: ${S.status.last_poll||'–'} · stažení zdrojů ${S.status.source_ms} ms · celý cyklus ${S.status.poll_ms} ms · interval ${S.status.live?'3 s (živé zápasy)':'30 s'} · zpoždění SSE push→prohlížeč ${S.lat.length?Math.round(S.lat.at(-1))+' ms':'–'}</p></div>`}
async function trackView(){let t;try{t=await api('/api/track')}catch(e){return `<h1>HISTORIE</h1><div class="box note">Historie predikcí zatím není k dispozici.</div>`}
 const s=t.summary||{},v=s.value||{},cal=s.calibration||[];
 const ok=r=>r.winner?((r.p>.5)===(r.winner===1)):null;
 let h=`<h1>HISTORIE PREDIKCÍ</h1><div class="box"><h3>ÚSPĚŠNOST</h3>${s.n?`<table><tr><th>ZÁPASŮ</th><th>PŘESNOST</th><th>BRIER</th><th>LOG LOSS</th></tr><tr><td>${s.n}</td><td>${(s.accuracy*100).toFixed(1)} %</td><td>${s.brier.toFixed(3)}</td><td>${s.log_loss.toFixed(3)}</td></tr></table>`:'<div class="note">Zatím žádný vyhodnocený zápas.</div>'}
 <p class="note">Počítají se jen predikce uložené před začátkem zápasu (čeká na výsledek: ${s.pending||0}). Brier: 0 = dokonalé, 0,25 = hod mincí.</p></div>`;
 if(cal.length)h+=`<div class="box"><h3>KALIBRACE</h3>${cal.map(b=>`<div class="bar" style="margin:5px 0"><span style="width:70px">${Math.round(b.lo*100)}–${Math.round(b.hi*100)} %</span><div class="t" style="background:#2a2060;position:relative"><i style="width:${b.real*100}%"></i><b style="position:absolute;left:${b.pred*100}%;top:-2px;bottom:-2px;width:2px;background:#fff"></b></div><span>${Math.round(b.real*100)} % · ${b.n}</span></div>`).join('')}<p class="note">Pruh = skutečný podíl výher, bílá čárka = průměrná předpověď. Dobře kalibrovaný model má čárku na konci pruhu.</p></div>`;
 h+=`<div class="box"><h3>VALUE TIPY (kurz před zápasem)</h3>${v.n?`<table><tr><th>TIPŮ</th><th>VÝHER</th><th>ZISK (1 j./tip)</th><th>ROI</th></tr><tr><td>${v.n}</td><td>${v.won}</td><td style="color:${v.profit>=0?'var(--grn)':'inherit'}">${v.profit.toFixed(2)}</td><td>${(v.roi*100).toFixed(1)} %</td></tr></table>`:'<div class="note">Zatím žádný vyhodnocený value tip.</div>'}<p class="note">Value = pravděpodobnost modelu × kurz − 1 ≥ 5 %, tj. model věří hráči víc, než naznačuje kurz.</p></div>`;
 const bc=Object.entries(s.by_circuit||{});if(bc.length)h+=`<div class="box"><h3>PODLE OKRUHU</h3><table><tr><th></th><th>N</th><th>PŘESNOST</th></tr>${bc.sort((a,b)=>b[1].n-a[1].n).map(([c,x])=>`<tr><td>${esc(c)}</td><td>${x.n}</td><td>${(x.accuracy*100).toFixed(1)} %</td></tr>`).join('')}</table></div>`;
 h+=`<div class="box"><h3>POSLEDNÍ PREDIKCE</h3>${(t.recent||[]).slice(0,100).map(r=>{const k=ok(r);return `<div class="fac"><span>${esc(r.date)} · ${esc(r.a)} – ${esc(r.b)} <small class="na">${esc(r.circuit||'')}</small></span><span>${pct(r.p)} : ${pct(1-r.p)} ${k==null?'<span class="na">čeká</span>':k?'✅':'❌'}</span></div>`}).join('')||'<div class="note">Prázdné.</div>'}</div>`;
 return h}
function chatView(){return `<h1>CHAT</h1><div id="msgs"><div class="msg">Ahoj! Napiš dvojici hráčů, např. „Sinner vs Alcaraz antuka“. Odpovídám z modelu (lokální asistent, bez AI).</div></div>
 <div style="padding:12px;display:flex;gap:8px"><input class="q" id="cq" placeholder="Zpráva…"><button class="ob" id="cs">➤</button></div>`}
function playersView(){return `<h1>HRÁČI</h1><p class="note" style="padding:0 12px">☆ = oblíbený hráč (uloženo v tomto zařízení). Oblíbených: ${S.favP.size}</p><div style="padding:0 12px"><input class="q" id="ps" placeholder="Hledat hráče…"></div><div id="plist"></div>`}

async function render(){const v=$('#view');let h='';
 if(S.view==='zapasy')h=matchesView(false);else if(S.view==='oblibene')h=matchesView(true);else if(S.view==='predikce')h=await predView();
 else if(S.view==='model')h=await modelView();else if(S.view==='historie')h=await trackView();else if(S.view==='chat'){if(v.dataset.v==='chat')return;h=chatView()}else if(S.view==='hraci'){if(v.dataset.v==='hraci')return;h=playersView()}
 v.dataset.v=S.view;v.innerHTML=h;bind();if(S.view==='zapasy'||S.view==='oblibene')S.vis=visKey()}

function pickBox(inp,list,cb){let t;inp.oninput=()=>{clearTimeout(t);t=setTimeout(async()=>{const r=inp.value.length>1?await api('/api/players?q='+encodeURIComponent(inp.value)):[];
 list.innerHTML=r.slice(0,6).map(p=>`<div class="fac" data-id="${p.id}" data-name="${esc(p.name)}"><span>${esc(p.name)} <small class="na">${p.g==='M'?'muži':'ženy'}</small></span><span class="na">Elo ${p.elo}${p.rank?' · #'+p.rank:''}</span></div>`).join('');
 list.querySelectorAll('[data-id]').forEach(x=>x.onclick=()=>{inp.value=x.dataset.name;inp.dataset.id=x.dataset.id;list.innerHTML='';cb&&cb(x.dataset.id)})},250)}}

function bind(){document.querySelectorAll('.days button').forEach(b=>b.onclick=()=>{S.day=+b.dataset.day;if(!S.data[S.day])load(S.day);render()});
 $('#circ')&&($('#circ').onchange=e=>{S.circ=e.target.value;render()});$('#filt')&&($('#filt').onchange=e=>{S.filt=e.target.value;render()});
 $('#nbtn')&&($('#nbtn').onclick=askNotif);$('#favt')&&($('#favt').onclick=()=>{S.favOnly=!S.favOnly;render()});
 document.querySelectorAll('.m[data-id]').forEach(x=>x.onclick=()=>openDetail(x.dataset.id));
 if(S.view==='predikce'){let surf='Hard';const go=async()=>{const a=$('#pa').dataset.id,b=$('#pb').dataset.id;if(!a||!b)return;
   const r=await api(`/api/predict?a=${a}&b=${b}&surface=${surf}`);$('#pres').innerHTML=`<div class="big2" style="margin-top:12px">${pct(r.p)} : ${pct(1-r.p)}</div>${explainBox(r.factors,r.p,[r.cards[0].name,r.cards[1].name],surf)}<div class="note">Elo ${pct(r.elo_p)} · ${r.h2h[0]==='?'?'H2H v této verzi nepočítáme':'H2H '+r.h2h.join(':')} · fér kurzy ${f2(1/r.p)} / ${f2(1/(1-r.p))}</div>${r.factors.map(f=>`<div class="fac"><span>${f.label}</span><span class="${f.favors}">${f.favors==='A'?r.cards[0].name:r.cards[1].name}</span></div>`).join('')}`};
  pickBox($('#pa'),$('#pal'),go);pickBox($('#pb'),$('#pbl'),go);document.querySelectorAll('#psurf button').forEach(b=>b.onclick=()=>{surf=b.dataset.s;document.querySelectorAll('#psurf button').forEach(x=>x.classList.toggle('on',x===b));go()})}
 if(S.view==='hraci'){const i=$('#ps');let t;i.oninput=()=>{clearTimeout(t);t=setTimeout(async()=>{const r=i.value.length>1?await api('/api/players?q='+encodeURIComponent(i.value)):[];
  $('#plist').innerHTML='<div class="box">'+(r.map(p=>`<div class="fac"><span><button class="pstar ${S.favP.has(p.id)?'on':''}" data-pid="${esc(p.id)}" title="Oblíbený hráč">${S.favP.has(p.id)?'★':'☆'}</button> ${esc(p.name)} <small class="na">${p.g==='M'?'ATP/ITF':'WTA/ITF'}</small></span><span class="na">Elo ${p.elo} · ${p.rank?'#'+p.rank:'bez žebř.'} · ${p.matches} záp.</span></div>`).join('')||'<div class="note">Nic nenalezeno</div>')+'</div>';
  $('#plist').querySelectorAll('.pstar').forEach(b=>b.onclick=()=>{const id=b.dataset.pid;if(S.favP.has(id))S.favP.delete(id);else S.favP.add(id);saveFav();const on=S.favP.has(id);b.classList.toggle('on',on);b.textContent=on?'★':'☆';toast(on?'Hráč přidán do oblíbených':'Hráč odebrán z oblíbených')})},250)}}
 if(S.view==='chat'){const send=async()=>{const q=$('#cq').value.trim();if(!q)return;$('#cq').value='';$('#msgs').insertAdjacentHTML('beforeend',`<div class="msg me">${esc(q)}</div>`);
  const r=await api('/api/chat?q='+encodeURIComponent(q));$('#msgs').insertAdjacentHTML('beforeend',`<div class="msg">${esc(r.answer)}</div>`)};$('#cs').onclick=send;$('#cq').onkeydown=e=>e.key==='Enter'&&send()}}

// ---- detail ----
async function openDetail(id,refresh){const d=await api('/api/match/'+encodeURIComponent(id));S.detail=d;if(!refresh)S.tab='prehled';drawDetail();if(!refresh)$('#detail').scrollTop=0}
function drawDetail(){const d=S.detail;if(d.status==='live'&&d.pred!=null&&typeof liveCalc==='function')liveCalc(d);const el=$('#detail');el.classList.remove('hidden');const [A,B]=d.players;
 const sp=TenisLive.liveSplit(d.sets,d.status),sa=sp.done.filter(s=>s[0]>s[1]).length,sb=sp.done.filter(s=>s[1]>s[0]).length;
 const setNo=d.status==='live'?(sp.n||1):0,gamesNow=d.status==='live'&&sp.cur?sp.cur.join('–'):'';const [tg,cl]=tagOf(d.circuit);const c=d.cards||[];
 const pp=(p,cd)=>`<div class="pp"><div class="av">${initials(p.name)}</div><b>${esc(shortN(p))}</b><small>${cd&&cd.rank?'#'+cd.rank:esc(p.country||'')}</small></div>`;
 let h=`<div class="dh"><button class="back" id="bk">‹</button><div class="tt"><b>${esc(d.tournament)}</b><small>${esc(d.circuit)} · ${surfCz[d.surface]||d.surface} · ${d.g==='M'?'Muži':'Ženy'}${d.qual?' · Kvalifikace':''}${d.round?' · '+esc(d.round):''}</small></div>${d.demo?'<span class="tag demo">DEMO</span>':''}<span class="tag ${cl}">${tg}</span></div>
 <div class="score">${pp(A,c[0])}<div class="mid"><div class="big">${sa}<span class="colon">:</span>${sb}</div><small>${gamesNow}</small><small>${d.status==='live'?`<span class="livebadge">▶ ${setNo}. set${d.pts_raw?' · Gem '+d.pts_raw.map(x=>x==50?'A':x).join(':'):''}${d.server?' · podává '+esc(sur(d.players[d.server-1])):''}</span>`:d.status==='finished'?'Konec':new Date(d.ts*1000).toLocaleString('cs-CZ',{timeZone:'Europe/Prague',weekday:'short',hour:'2-digit',minute:'2-digit'})}</small>
 <button class="star ${S.fav.has(d.id)?'on':''}" id="fv" style="margin-top:8px;height:38px">${S.fav.has(d.id)?'★':'☆'}</button></div>${pp(B,c[1])}</div>
 <div class="tabs">${[['prehled','Přehled'],['predikce','Predikce'],['kurzy','Kurzy'],['h2h','H2H'],['stat','Statistiky']].map(([k,t])=>`<button data-t="${k}" class="${S.tab===k?'on':''}">${t}</button>`).join('')}</div>`;
 h+=({prehled:tPrehled,predikce:tPred,kurzy:tKurzy,h2h:tH2H,stat:tStat}[S.tab])(d);el.innerHTML=h;
 $('#bk').onclick=()=>{el.classList.add('hidden');S.detail=null};$('#fv').onclick=()=>{S.fav.has(d.id)?S.fav.delete(d.id):S.fav.add(d.id);saveFav();drawDetail()};
 el.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>{S.tab=b.dataset.t;drawDetail()});el.querySelectorAll('.seg button[data-who]').forEach(b=>b.onclick=()=>{S.who=b.dataset.who;drawDetail()})}
const sur=p=>{const n=p.name||'';return /\s\w\.$/.test(n)?n.replace(/\s\w\.$/,''):n.split(' ').slice(1).join(' ')||n};const nA=d=>sur(d.players[0]), nB=d=>sur(d.players[1]);
function bar2(p){return `<div class="bar"><span>${pct(p)}</span><div class="t"><i style="width:${p*100}%"></i></div><span>${pct(1-p)}</span></div>`}
function big2p(p,d,label,extra){return `<div class="lbl">${label}</div><div class="pp2"><div><b class="pa">${pct(p)}</b><small>${esc(shortN(d.players[0]))}</small></div><div><b class="pb">${pct(1-p)}</b><small>${esc(shortN(d.players[1]))}</small></div></div>${bar2(p).replace(/<span>[^<]*<\/span>/g,'')}${extra||''}`}
function tPrehled(d){if(d.pred==null)return `<div class="box note">Pro tento zápas nemáme historii hráčů ani jejich žebříček – predikce není k dispozici.</div>`;
 const pre=d.odds_pre?Object.values(d.odds_pre):null,avg=i=>pre?(pre.reduce((s,x)=>s+x[i],0)/pre.length):null;
 let h=`<div class="box">`;
 if(d.live)h+=big2p(d.live.match,d,'<span style="color:var(--grn)">PREDIKCE TEĎ</span>')+'<div style="height:14px"></div>';
 h+=big2p(d.pred,d,'PREDIKCE MODELU'+(d.pred_low?' <span class="low">nízká spolehlivost</span>':''),
  (d.odds?`<div class="note" style="margin-top:6px">kurz ${d.live?'nejlepší':'před zápasem'} <b class="pa">${f2(d.odds.best_a)}</b> : <b class="pb">${f2(d.odds.best_b)}</b></div>`:'')+
  `<p class="note">${d.pred_low?esc(d.pred_note||'Odhad – nízká spolehlivost.'):(d.live?'Z předzápasové šance, síly hráčů a skóre (sety, gemy, body, podání). Po každém bodu/gemu se posune.':'Před zápasem: LightGBM'+(d.pred_lr!=null?' · logistická regrese '+pct(d.pred_lr):'')+(d.elo_p!=null?' · Elo '+pct(d.elo_p):'')+'.')}</p>`);
 if(d.live){const L=d.live;
  if(L.game!=null)h+=`<div class="sep"></div><div class="lbl">GEM TEĎ</div><div class="pp2"><div><b class="pa">${pct(L.game)}</b><small>${esc(shortN(d.players[0]))}</small></div><div><b class="pb">${pct(1-L.game)}</b><small>${esc(shortN(d.players[1]))}</small></div></div><p class="note">Z aktuálního stavu bodů a podávajícího.</p>`;
  const [pa,pb]=[L.serve_a,L.serve_b],ps=(MK.setP(pa,pb,0,0,true)+MK.setP(pa,pb,0,0,false))/2,sp=TenisLive.liveSplit(d.sets,d.status),n=Math.max(sp.n,1),need=Math.floor(d.best_of/2)+1;
  h+=`<div class="sep"></div><div class="lbl">KDO BERE SET</div>`;
  for(let k=1;k<=d.best_of;k++){const s=sp.done[k-1];let p,lab;
   if(k<n){p=s&&s[0]>s[1]?1:0;lab='odehráno'}else if(k===n){p=L.set;lab='teď'}else{p=ps;lab=k===n+1?'podle skóre':'když bude'}
   h+=`<div class="setrow"><div><b>${k}. set</b><small>${lab}</small></div><div><b class="pa">${pct(p)}</b></div><div><b class="pb">${pct(1-p)}</b></div></div>`}
  h+=`<p class="note">${esc(L.note)}.</p>`}
 h+='</div>';
 if(d.markov)h+=`<div class="box"><h3>PODÁNÍ A GEMY (MARKOV)</h3><table><tr><th></th><th>${esc(nA(d))}</th><th>${esc(nB(d))}</th></tr><tr><td>Bod na podání</td><td>${pct(d.markov.serve_a)}</td><td>${pct(d.markov.serve_b)}</td></tr><tr><td>Udržení podání</td><td>${pct(d.markov.hold_a)}</td><td>${pct(d.markov.hold_b)}</td></tr><tr><td>Výhra 1. setu</td><td>${pct(d.markov.set1)}</td><td>${pct(1-d.markov.set1)}</td></tr></table></div>`;
 if(d.live)h+=liveTipsBox(d);
 h+=explainBox(d.factors,d.pred,[nA(d),nB(d)],d.surface,d.factors_src);
 return h}
function explainBox(factors,p,names,surf,src){if(p==null||!factors||!factors.length)return '';const rs=Explain.rows(factors,p,names,surf);if(!rs.length)return '';const mx=Math.max(...rs.map(r=>r.pp),1);
 return `<div class="box xpl"><h3>PROČ TENTO TIP</h3><p class="note">${esc(Explain.summary(rs,p,names))}</p>${rs.map(r=>`<div class="xr"><div class="xl"><b>${esc(r.label)}</b><small>${esc(r.who)}${r.text?' · '+esc(r.text):''}</small></div><div class="xb ${r.side==='A'?'pa':'pb'}"><i style="width:${Math.max(6,r.pp/mx*100)}%"></i></div><span class="xv">+${r.pp.toFixed(1).replace('.',',')} b.</span></div>`).join('')}
 <p class="note">Velikost = o kolik procentních bodů faktor posouvá šanci zvýhodněného hráče (vysvětlitelná logistická regrese${src?', spočítáno v '+esc(src)+'i':''}); výsledná šance je z LightGBM.</p></div>`}
function liveTipsBox(d){const L=d.live;if(!L)return '';const pa=L.serve_a??L.pa,pb=L.serve_b??L.pb;if(pa==null||pb==null)return '';
 const bo=d.best_of||3,pts=d.pts||[0,0],view=TenisLive.tbView(d.sets,pts,bo,d.match_tb);let done,cur,matchTb=false,tbTo=null;
 if(view&&view.kind==='match'){done=TenisLive.liveSplit(d.sets,'finished').done;cur=[0,0];matchTb=true;tbTo=view.target}else{const sp=TenisLive.liveSplit(d.sets,'live');done=sp.done;cur=sp.cur||[0,0];if(view)tbTo=view.target;if(done.length>=bo-1)tbTo=10}
 let t;try{t=InTips.compute({pa,pb,done,cur,pts:d.pts||[0,0],server:d.server||null,bo,tbTo,matchTb})}catch(e){return ''}
 const [a,b]=[nA(d),nB(d)],items=InTips.view(t,{done,matchTb,names:[nA(d),nB(d)]}),n1=x=>String(x).replace('.',','),cnd=x=>x.cond?' <small>(pokud se hraje)</small>':'';
 if(!items.length)return '';
 const it=x=>{if(x.type==='win')return `<div class="lt"><div class="ltl">${x.label}${cnd(x)}</div><div class="ltbar"><i style="width:${x.a*100}%"></i></div><div class="ltn"><span class="pa">${esc(a)} ${pct(x.a)}</span><span class="pb">${pct(1-x.a)} ${esc(b)}</span></div></div>`;
  if(x.type==='yes')return `<div class="lt ltrow"><span>${x.label}${cnd(x)}</span><b>${pct(x.p)}</b></div>`;
  return `<div class="lt"><div class="ltl">${x.label}:</div><div class="ltrow"><span>více než ${n1(x.line)} – <b>${pct(x.over)}</b></span><span>méně – <b>${pct(1-x.over)}</b></span></div></div>`};
 return `<div class="box ltips"><h3>TIPY V PRŮBĚHU</h3>${items.map(it).join('')}<details class="ltd"><summary>Jak se to počítá</summary><p class="note">Model bod po bodu z aktuálního skóre${d.server?' a podávajícího':''}. Tiebreak se počítá jako 1 gam. Téměř jisté tipy (nad 95 %) skrýváme.</p></details></div>`}
function tPred(d){if(!d.cards||!d.cards[0]||!d.cards[1])return '<div class="box note">Predikce nedostupná.</div>';const [a,b]=d.cards;
 return `<div class="box note"><b>Predikce ${pct(d.live?d.live.match:d.pred)} : ${pct(1-(d.live?d.live.match:d.pred))}</b>. Před zápasem ${pct(d.pred)} : ${pct(1-d.pred)}. Rozpis faktorů je předzápasový.</div>
 <div class="box"><div class="note">${esc(d.circuit)} · ${surfCz[d.surface]} · na ${d.best_of} sety</div></div>${explainBox(d.factors,d.pred,[nA(d),nB(d)],d.surface,d.factors_src)}<div class="box"><h3>HLAVNÍ FAKTORY</h3>${(d.factors||[]).map(f=>`<div class="fac"><span>${f.label}</span><span class="${f.favors}">${'▮'.repeat(Math.min(4,1+Math.round(Math.abs(f.value)*6)))} ${esc(f.favors==='A'?a.name:b.name)}</span></div>`).join('')}
 <p class="note">Faktory = příspěvky v logistické regresi (vysvětlitelná část modelu); výsledná pravděpodobnost je z LightGBM.</p></div>
 <div class="box"><h3>SROVNÁNÍ</h3><table><tr><th></th><th>${esc(nA(d)).toUpperCase()}</th><th>${esc(nB(d)).toUpperCase()}</th></tr>
 <tr><td>Elo celkové</td><td>${a.elo}</td><td>${b.elo}</td></tr><tr><td>Elo – ${surfCz[d.surface]}</td><td>${a.selo}</td><td>${b.selo}</td></tr><tr><td>Žebříček</td><td>${a.rank??'–'}</td><td>${b.rank??'–'}</td></tr>
 <tr><td>Forma (výhry z posl. 10)</td><td>${a.form}</td><td>${b.form}</td></tr><tr><td>Zápasů celkem (od 1968)</td><td>${a.matches}</td><td>${b.matches}</td></tr><tr><td>Poslední zápas v datech</td><td>${a.last||'–'}</td><td>${b.last||'–'}</td></tr></table></div>`}
function tKurzy(d){const o=d.odds_table||[];if(!o.length)return `<div class="box note">Pro tento zápas teď žádný veřejný zdroj (Flashscore, Sofascore) kurzy nenabízí. Kurzy nevymýšlíme – jakmile se objeví, zobrazí se tu automaticky.</div>`;
 const p=d.live?d.live.match:d.pred,prev=d.odds_prev||{},pre=d.odds_pre||{};
 const arr=(v,old)=>old==null||v===old?'':v>old?' <span class="up">▲</span>':' <span class="dn">▼</span>';
 const ba=Math.max(...o.map(x=>x.a)),bb=Math.max(...o.map(x=>x.b)),aa=o.reduce((s,x)=>s+x.a,0)/o.length,ab=o.reduce((s,x)=>s+x.b,0)/o.length;
 let h=`<div class="box"><h3>${d.status==='live'?'ŽIVÉ KURZY V PRŮBĚHU':'KURZY PŘED ZÁPASEM'}</h3><table><tr><th>SÁZKOVÁ KANCELÁŘ</th><th>${esc(nA(d)).toUpperCase()}</th><th>${esc(nB(d)).toUpperCase()}</th></tr>`;
 for(const x of o)h+=`<tr><td>${esc(x.bookmaker)}</td><td class="${x.a===ba&&o.length>1?'best':''}">${f2(x.a)}${arr(x.a,(prev[x.bookmaker]||pre[x.bookmaker]||[])[0])}</td><td class="${x.b===bb&&o.length>1?'best':''}">${f2(x.b)}${arr(x.b,(prev[x.bookmaker]||pre[x.bookmaker]||[])[1])}</td></tr>`;
 if(o.length>1)h+=`<tr class="sum"><td>Průměr (${o.length})</td><td>${f2(aa)}</td><td>${f2(ab)}</td></tr><tr class="sum"><td>Nejlepší</td><td>${f2(ba)}</td><td>${f2(bb)}</td></tr>`;
 h+=`</table><p class="note"><span class="up">▲</span> kurz roste, <span class="dn">▼</span> klesá proti minulému načtení. Obnovuje se průběžně, dokud je zápas živý a stránka viditelná. Zdroj: ${d.odds_src==='Sofascore'?'Sofascore (průměr trhu)':'veřejné kurzové srovnání Flashscore, kanceláře pro CZ'}.</p></div>`;
 const fa=(1/aa)/((1/aa)+(1/ab)),marg=1/aa+1/ab-1;
 h+=`<div class="box"><h3>MODEL VS. TRH</h3><table><tr><th></th><th>${esc(nA(d))}</th><th>${esc(nB(d))}</th></tr><tr><td>Implikovaná pravděpodobnost (bez marže)</td><td>${pct(fa)}</td><td>${pct(1-fa)}</td></tr>`+
  (p!=null?`<tr><td>Model${d.live?' (teď)':''}</td><td>${pct(p)}</td><td>${pct(1-p)}</td></tr><tr><td>Návratnost s nejlepším kurzem</td><td style="color:${p*ba-1>.05?'var(--grn)':'inherit'}">${((p*ba-1)*100).toFixed(1)} %</td><td style="color:${(1-p)*bb-1>.05?'var(--grn)':'inherit'}">${(((1-p)*bb-1)*100).toFixed(1)} %</td></tr>`:'')+
  `</table><div class="fac"><span>Marže sázkových kanceláří</span><b>${(marg*100).toFixed(1)} %</b></div><div class="fac"><span>Práh pro „value“</span><b>návratnost ≥ 5 % a kurz mladší 90 s</b></div>
  <p class="note">Trh bývá přesnější než samotný model (model nevidí zranění, motivaci ani formu mimo data). Velký rozdíl často znamená chybějící informaci v modelu, ne chybu trhu. Není to doporučení k sázce.</p></div>`;
 return h}
function tH2H(d){const l=d.h2h_list||[];return `<div class="box"><h3>VZÁJEMNÉ ZÁPASY</h3><div class="big2">${(d.h2h||[0,0]).join(' : ')}</div><p class="note">${esc(nA(d))} : ${esc(nB(d))} (historická data od 1968)</p>
 ${l.map(x=>`<div class="fac"><span>${x.date.slice(0,4)} · ${esc(x.tournament)} <small class="na">${surfCz[x.surface]||''} ${esc(x.round)}</small></span><span class="${x.winner}">${esc(x.winner==='A'?nA(d):nB(d))} ${esc(x.score)}</span></div>`).join('')||'<div class="note">Zatím spolu nehráli.</div>'}</div>`}
function formSeries(card,end){// klouzavý průměr (skutečnost − očekávání Elo) za 30 dní, bod každé 3 dny, posledních 60 dní
 const r=(card&&card.resid||[]).map(([d,x])=>[Date.parse(d),x]);const pts=[];for(let k=20;k>=0;k--){const t=end-k*3*864e5;const w=r.filter(([d])=>d<=t&&d>t-30*864e5);pts.push([t,w.length?w.reduce((s,x)=>s+x[1],0)/w.length:0,w.length])}return pts}
function tStat(d){const c=d.cards||[];if(!c[0]||!c[1])return '<div class="box note">Statistiky nedostupné.</div>';
 const end=Math.max(...[c[0].last,c[1].last].filter(Boolean).map(Date.parse));const sA=formSeries(c[0],end),sB=formSeries(c[1],end);const who=S.who||'all';
 const W=400,H=200,y=v=>H/2-v*(H/2)/0.6,x=i=>i*(W/20);const path=s=>s.map((p,i)=>(i?'L':'M')+x(i)+','+y(Math.max(-.6,Math.min(.6,p[1])))).join('');
 const la=sA.at(-1),lb=sB.at(-1);
 let svg=`<svg viewBox="-30 -5 440 225" style="width:100%"><defs><linearGradient id="gg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1e6b55" stop-opacity=".5"/><stop offset=".5" stop-color="#1d1347" stop-opacity="0"/><stop offset="1" stop-color="#7a1f3d" stop-opacity=".5"/></linearGradient></defs><rect x="0" y="0" width="${W}" height="${H}" fill="url(#gg)"/>`;
 for(const v of [.6,.4,.2,0,-.2,-.4,-.6])svg+=`<line x1="0" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="#33276e" stroke-width="${v?0.5:1}"/><text x="-4" y="${y(v)+4}" fill="#9a90c9" font-size="10" text-anchor="end">${Math.round(v*100)}%</text>`;
 [0,7,14,20].forEach(i=>svg+=`<text x="${x(i)}" y="${H+15}" fill="#9a90c9" font-size="10" text-anchor="middle">${new Date(sA[i][0]).toLocaleDateString('cs-CZ',{day:'numeric',month:'numeric'})}</text>`);
 if(who!=='b')svg+=`<path d="${path(sA)}" stroke="#5b8cff" fill="none" stroke-width="2" stroke-dasharray="5 3"/>`;if(who!=='a')svg+=`<path d="${path(sB)}" stroke="#a57cff" fill="none" stroke-width="2.4"/>`;svg+='</svg>';
 const k=4,lg=p=>Math.log(p/(1-p)),sg=z=>1/(1+Math.exp(-z));const adj=d.pred!=null?sg(lg(d.pred)+k*(la[1]-lb[1])):null;
 return `<div class="box"><h2>HODNOCENÍ FORMY HRÁČŮ</h2><p class="note">Porovnává skutečné výsledky s očekáváním podle Elo před každým zápasem (30denní klouzavý průměr).</p>
 <div class="two"><div><div class="big2" style="color:${la[1]<0?'var(--pink)':'var(--grn)'};font-size:26px">${(la[1]*100).toFixed(1).replace('.',',')} %</div><b style="color:#5b8cff">${esc(shortN(d.players[0]))}</b><div class="note">${la[2]?la[2]+' záp. za 30 dní':'za 30 dní bez zápasu'}</div></div>
 <div><div class="big2" style="color:${lb[1]<0?'var(--pink)':'var(--grn)'};font-size:26px">${(lb[1]*100).toFixed(1).replace('.',',')} %</div><b style="color:#a57cff">${esc(shortN(d.players[1]))}</b><div class="note">${lb[2]?lb[2]+' záp. za 30 dní':'za 30 dní bez zápasu'}</div></div></div>
 <div class="box" style="margin:12px 0 0"><h3>FORMA V ČASE</h3>${svg}<div class="seg"><button data-who="all" class="${who==='all'?'on':''}">VŠE</button><button data-who="a" class="${who==='a'?'on':''}">${esc(nA(d)).toUpperCase()}</button><button data-who="b" class="${who==='b'?'on':''}">${esc(nB(d)).toUpperCase()}</button></div>
 <p class="note">Posledních 60 dní historických dat (do ${new Date(end).toLocaleDateString('cs-CZ')}), bod každé 3 dny.</p></div></div>
 ${adj!=null?`<div class="box"><h3>KURZY UPRAVENÉ PODLE FORMY</h3><p class="note">Hypotetický scénář: kdyby oba pokračovali v současném trendu formy. <b>Není to predikce modelu.</b></p><table><tr><th></th><th>MODEL</th><th>PODLE FORMY</th><th>FÉR KURZ</th></tr><tr><td>${esc(nA(d))}</td><td>${pct(d.pred)}</td><td>${pct(adj)}</td><td>${f2(1/adj)}</td></tr><tr><td>${esc(nB(d))}</td><td>${pct(1-d.pred)}</td><td>${pct(1-adj)}</td><td>${f2(1/(1-adj))}</td></tr></table></div>`:''}`}

document.querySelectorAll('nav.bottom button').forEach(b=>b.onclick=()=>{S.view=b.dataset.v;document.querySelectorAll('nav.bottom button').forEach(x=>x.classList.toggle('on',x===b));$('#detail').classList.add('hidden');S.detail=null;render()});
load(0).then(()=>{for(const d of [-2,-1,1,2])load(d)});stream();
if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js');
// ---- upozornění pro oblíbené zápasy (v aplikaci; systémová notifikace jen když prohlížeč dovolí bez push serveru) ----
const FP={};function toast(t){const e=document.createElement('div');e.className='toast';e.textContent=t;document.body.appendChild(e);setTimeout(()=>e.remove(),5000)}
function notify(t){toast(t);if(window.Notification&&Notification.permission==='granted'&&navigator.serviceWorker)navigator.serviceWorker.ready.then(r=>r.showNotification('Tenis · oblíbené',{body:t,icon:'icon.svg',tag:'fav'})).catch(()=>{})}
function favEvents(ids){for(const id of ids){const m=(typeof ST!=='undefined'&&ST.byId[id])||null;if(!m||!isFav(m))continue;const o=FP[id];const nm=`${sur(m.players[0])} – ${sur(m.players[1])}`;
  const done=TenisLive.liveSplit(m.sets,m.status).done;if(o){if(o.status==='upcoming'&&m.status==='live')notify(`▶ Začal zápas ${nm}`);
   else if(m.status==='finished'&&o.status!=='finished')notify(`🏁 Konec: ${nm} ${m.sets.map(s=>s.join(':')).join(' ')}`);else if(done.length>o.sets)notify(`Set: ${nm} ${m.sets.map(s=>s.join(':')).join(' ')}`)}
  const sw=swingCheck(o&&o.pn,m);if(sw)notify(sw.text);
  FP[id]={status:m.status,sets:done.length,pn:sw?sw.p:(o&&o.pn!=null?o.pn:livePr(m))}}}
const SWING=.15;function livePr(m){return m.live&&m.live.match!=null?m.live.match:null}
// velký zvrat: živá pravděpodobnost se od poslední zprávy posunula aspoň o 15 procentních bodů
function swingCheck(prev,m){const p=livePr(m);if(p==null||prev==null||m.status!=='live')return null;if(Math.abs(p-prev)<SWING)return null;
 const lead=p>=.5?sur(m.players[0]):sur(m.players[1]);return {p,text:`📈 Zvrat: ${sur(m.players[0])} – ${sur(m.players[1])}, šance ${Math.round(p*100)} : ${Math.round((1-p)*100)} % (${lead} vede)`}}
async function askNotif(){if(!window.Notification){toast('Tento prohlížeč systémová upozornění bez serveru nepodporuje – upozornění se ukážou v aplikaci, dokud je otevřená.');return}
 const r=await Notification.requestPermission();toast(r==='granted'?'Upozornění povolena (jen když je aplikace otevřená nebo na pozadí v prohlížeči).':'Upozornění nepovolena – zůstanou jen v aplikaci.')}
// ---- tažení dolů = obnovit ----
(()=>{let y0=null,act=false;const ptr=document.createElement('div');ptr.className='ptr';ptr.textContent='↓ Pusť pro obnovení';const v=document.getElementById('view');v.parentNode.insertBefore(ptr,v);
 addEventListener('touchstart',e=>{y0=(scrollY<=0&&$('#detail').classList.contains('hidden'))?e.touches[0].clientY:null},{passive:true});
 addEventListener('touchmove',e=>{if(y0==null)return;act=e.touches[0].clientY-y0>70;ptr.classList.toggle('on',act)},{passive:true});
 addEventListener('touchend',async()=>{if(act){ptr.textContent='Obnovuji…';try{if(STATIC){_st0=loadStatic();await _st0;for(let d=-2;d<=2;d++)S.data[d]=ST.all.filter(m=>m.day===d)}else await load(S.day)}catch(e){}render();upd();ptr.textContent='↓ Pusť pro obnovení'}
  ptr.classList.remove('on');act=false;y0=null})})();
function placeMatch(m){let home=false;for(const d of Object.keys(S.data)){const arr=S.data[d];const i=arr.findIndex(x=>x.id===m.id);if(i<0)continue;if((m.day|0)!==+d)arr.splice(i,1);else{if(arr[i]!==m)arr[i]=m;home=true}}
 const day=m.day|0;const arr=S.data[day]||(S.data[day]=[]);if(!home&&!arr.some(x=>x.id===m.id))arr.push(m)}
function staticLoop(){const onCh=ids=>{for(const id of ids||[]){const m=ST.byId[id];if(m)placeMatch(m)}upd();cacheSave();
  if(S.view==='zapasy'||S.view==='oblibene'){paintList(ids);const lp=document.querySelector('h1 .pill');const t=`● ${ST.all.filter(m=>m.status==='live').length} živě`;if(lp&&lp.textContent!==t)lp.textContent=t}
  if(S.detail&&ids.includes(S.detail.id)){const m=ST.byId[S.detail.id];const sig=m&&scoreSig(m);if(m&&S.detail._lsig!==sig){Object.assign(S.detail,m);S.detail._lsig=sig;drawDetail()}}
  favEvents(ids)};
 startSources(onCh);
 const odd=async()=>{const l=ST.all.filter(m=>m.status==='live'&&m.fs);for(const m of l){if(document.hidden)break;await oddsFor(m);await new Promise(r=>setTimeout(r,700))}onCh(l.map(m=>m.id));setTimeout(odd,30000)};setTimeout(odd,8000);
 setInterval(async()=>{try{_st0=loadStatic();await _st0;onCh(ST.all.map(m=>m.id))}catch(e){}},300000);
 setInterval(upd,60000)}
