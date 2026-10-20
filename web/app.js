'use strict';
const $=s=>document.querySelector(s), esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const S={view:'zapasy',day:0,circ:'all',filt:'all',favOnly:false,data:{},fav:new Set(JSON.parse(localStorage.fav||'[]')),detail:null,tab:'prehled',status:{},lat:[]};
const DN=['Neděle','Pondělí','Úterý','Středa','Čtvrtek','Pátek','Sobota'];
const pct=x=>x==null?'–':Math.round(x*100)+' %', f2=x=>x==null?'–':(+x).toFixed(2);
const initials=n=>(n||'?').replace(/[^\p{L} ]/gu,'').split(' ').filter(Boolean).map(w=>w[0]).slice(0,2).join('').toUpperCase();
const shortN=p=>{const n=p.name||'';if(/\s\w\.$/.test(n))return n; const t=n.split(' ');return t.length>1?t[0][0]+'. '+t.slice(1).join(' '):n};
const surfCz={Hard:'Tvrdý',Clay:'Antuka',Grass:'Tráva',Carpet:'Koberec'};
const tagOf=c=>c==='ATP'?['ATP','atp']:c==='WTA'?['WTA','wta']:c==='Challenger'?['CH','']:c==='WTA 125'?['125','wta']:c.startsWith('ITF')?['ITF','itf']:[c,''];
async function api(u){if(STATIC)return staticApi(u);const r=await fetch(u);if(!r.ok)throw new Error(r.status);return r.json()}
function saveFav(){localStorage.fav=JSON.stringify([...S.fav])}

let _st0=null;async function load(day){if(STATIC){if(!_st0&&cacheLoad()){for(let d=-2;d<=2;d++)S.data[d]=ST.all.filter(m=>m.day===d);render();upd()}_st0=_st0||loadStatic();await _st0}const d=await api('/api/matches?day='+day);S.data[day]=d.matches;S.status=d.status;render();upd()}
function upd(){const s=S.status||{};if(STATIC){const lv=ST.all.filter(m=>m.status==='live').length;s.live=lv;const H={sofascore:'Sofascore',s365:'365scores',espn:'ESPN',sofaDetail:'detail'};const hd=health().map(h=>`<span class="hd ${h.state}" title="${H[h.k]}">${H[h.k]}</span>`).join('');
  const age=ST.generated?Math.round((Date.now()/1000-ST.generated)/60):null;
  $('#upd').innerHTML=`<span class="g"></span>${lv?'Živě':'Bez živých zápasů'} · ${lv} · predikce před ${age??'–'} min<div class="hrow">${hd}</div>`;return;
  $('#upd').innerHTML=`<span class="g"></span>${lv?'Živě':'Bez živých zápasů'} · skóre ${ST.lastLive?ST.lastLive.toLocaleTimeString('cs-CZ'):'–'} (${ST.liveMs??'–'} ms) · predikce ${ST.generated?new Date(ST.generated*1000).toLocaleTimeString('cs-CZ',{hour:'2-digit',minute:'2-digit'}):'–'}`;return}
 const l=S.lat.length?` · zpoždění push ${Math.round(S.lat.at(-1))} ms`:'';
 $('#upd').innerHTML=(s.demo?'<span class="tag demo">DEMO</span> ':'<span class="g"></span>')+`${s.live?'Živě':'Bez živých zápasů'} · aktualizováno ${s.last_poll?new Date(s.last_poll).toLocaleTimeString('cs-CZ'):'–'}${l}`}

// ---- SSE: okamžité aktualizace ----
function stream(){if(STATIC)return staticLoop();const es=new EventSource('/api/stream');
 es.onmessage=e=>{const m=JSON.parse(e.data);if(m.status)S.status=m.status;
  if(m.type==='update'){S.lat.push(Date.now()-m.t_push*1000);for(const x of m.matches){const arr=S.data[x.day];if(!arr)continue;const i=arr.findIndex(y=>y.id===x.id);if(i>=0)arr[i]=x;else arr.push(x)}
   api('/api/status').then(s=>{S.status=s;upd()});if(S.view==='zapasy'||S.view==='oblibene')render();
   if(S.detail&&m.matches.some(x=>x.id===S.detail.id))openDetail(S.detail.id,true)}
  upd()};}

function filt(list){return list.filter(m=>{
 if(S.circ!=='all'){if(S.circ==='CH'){if(!['Challenger','WTA 125'].includes(m.circuit))return false}else if(m.circuit!==S.circ)return false}
 if(S.filt==='live'&&m.status!=='live')return false;if(S.filt==='up'&&m.status!=='upcoming')return false;if(S.filt==='fin'&&m.status!=='finished')return false;
 if(S.filt==='value'&&!m.value)return false;if(S.filt==='qual'&&!m.qual)return false;if(S.filt==='main'&&m.qual)return false;
 if(S.favOnly&&!S.fav.has(m.id))return false;return true})}

function card(m){const fin=m.status==='finished',live=m.status==='live';
 const sc=i=>m.sets.map((s,k)=>`<span class="${live&&k===m.sets.length-1?'cur':''}">${s[i]}</span>`).join('');
 const t=new Date(m.ts*1000).toLocaleTimeString('cs-CZ',{hour:'2-digit',minute:'2-digit'});
 const p=m.live?m.live.match:m.pred;
 const pl=(i)=>`<div class="row"><div class="pl ${m.winner===i+1?'w':''}"><span class="flag">${esc((m.players[i].country||'').slice(0,3).toUpperCase())}</span>${esc(shortN(m.players[i]))}${!m.pids[i]?' <span class="na">(bez historie)</span>':''}</div>
   ${m.sets.length?`<div class="sc">${m.server===i+1?'<span style="color:#ffc84a">●</span>':''}${sc(i)}${m.pts_raw?`<span class="cur">${m.pts_raw[i]==50?'A':m.pts_raw[i]}</span>`:''}</div>`:i===0?`<div class="time">${t}</div>`:''}${i===0&&live?' <span class="livebadge">▶ živě</span>':''}</div>`;
 let h=`<div class="m" data-id="${m.id}">${pl(0)}${pl(1)}`;
 if(p!=null)h+=`<div class="lbl">${m.live?'ŽIVÁ PRAVDĚPODOBNOST':'PREDIKCE MODELU'}</div><div class="bar"><span>${pct(p)}</span><div class="t"><i style="width:${p*100}%"></i></div><span>${pct(1-p)}</span></div>`;
 else h+=`<div class="na" style="margin-top:6px">Predikce nedostupná – hráč není v historických datech</div>`;
 if(m.odds)h+=`<div class="odds"><span class="ob ${m.value==='A'?'val':''}">${f2(m.odds.best_a)}${m.value==='A'?' ▲':''}</span><span>nejlepší kurz · ${m.odds.n} sázk.</span><span class="ob ${m.value==='B'?'val':''}">${f2(m.odds.best_b)}${m.value==='B'?' ▲':''}</span></div>`;
 else if(!fin)h+=`<div class="odds"><span class="na">kurzy nedostupné</span></div>`;
 return h+'</div>'}

function matchesView(fav){const today=new Date();let h='';
 if(!fav){h+=`<h1>ZÁPASY <span class="pill">● ${(S.data[0]||[]).filter(m=>m.status==='live').length} živě</span></h1><div class="days">`;
  for(let d=-2;d<=2;d++){const x=new Date(today);x.setDate(x.getDate()+d);const n=d===0?'Dnes':d===-1?'Včera':d===1?'Zítra':DN[x.getDay()];
   h+=`<button data-day="${d}" class="${d===S.day?'on':''}"><b>${n}</b><small>${x.getDate()}. ${x.getMonth()+1}.</small></button>`}
  h+=`</div><div class="filters"><div class="sel"><label>OKRUHY</label><select id="circ">${[['all','Všechny okruhy'],['ATP','ATP'],['WTA','WTA'],['CH','Challenger / WTA 125'],['ITF muži','ITF muži'],['ITF ženy','ITF ženy']].map(([v,t])=>`<option value="${v}" ${S.circ===v?'selected':''}>${t}</option>`).join('')}</select></div>
  <div class="sel"><label>FILTR</label><select id="filt">${[['all','Vše'],['live','Živě'],['up','Nadcházející'],['fin','Dokončené'],['value','Value'],['qual','Kvalifikace'],['main','Hlavní soutěž']].map(([v,t])=>`<option value="${v}" ${S.filt===v?'selected':''}>${t}</option>`).join('')}</select></div>
  <button class="star ${S.favOnly?'on':''}" id="favt">${S.favOnly?'★':'☆'}</button></div>`}
 else h+='<h1>OBLÍBENÉ</h1>';
 const all=fav?Object.values(S.data).flat().filter(m=>S.fav.has(m.id)):filt(S.data[S.day]||[]);
 if(!all.length)return h+`<div class="empty">${S.data[S.day]?'Žádné zápasy pro zvolený filtr.':'Načítám…'}${fav?'<br>Hvězdičkou v detailu zápasu přidáš oblíbené.':''}</div>`;
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
 <div class="box"><h3>PRŮBĚŽNÉ UČENÍ</h3><p class="note">${m.incremental?`Při posledním exportu započteno ${m.incremental.applied} nově dohraných zápasů do Elo/formy/H2H (bez přetrénování).`:''} Denně se model přetrénuje; nový se publikuje jen, když na holdoutu (posledních 8 týdnů) porazí Elo a není výrazně horší než minule publikovaný.</p>
 ${(m.history||[]).length?`<table><tr><th>DATUM</th><th>HOLDOUT</th><th>NOVÝ</th><th>STARÝ</th><th></th></tr>${m.history.slice(-10).reverse().map(h=>`<tr><td>${h.at.slice(0,10)}</td><td>${h.holdout_n}</td><td>${h.candidate.log_loss.toFixed(4)}</td><td>${h.current.log_loss.toFixed(4)}</td><td>${h.published?'✅':'↩︎'}</td></tr>`).join('')}</table><p class="note">Log loss na holdoutu; ✅ = publikováno, ↩︎ = ponechán starý model.</p>`:'<p class="note">Zatím žádné přetrénování.</p>'}</div>
 <div class="box"><h3>PODLE OKRUHU (LightGBM vs Elo)</h3><table><tr><th></th><th>N</th><th>LGBM</th><th>ELO</th></tr>${Object.entries(m.by_circuit).map(([c,v])=>`<tr><td>${c}</td><td>${v.lightgbm.n}</td><td>${(v.lightgbm.accuracy*100).toFixed(1)} %</td><td>${(v.elo.accuracy*100).toFixed(1)} %</td></tr>`).join('')}</table></div>
 <div class="box"><h3>DŮLEŽITOST PŘÍZNAKŮ (gain)</h3>${Object.entries(m.importance).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<div class="bar" style="margin:5px 0"><span style="width:90px">${k}</span><div class="t" style="background:#2a2060"><i style="width:${v*100}%"></i></div><span>${(v*100).toFixed(1)} %</span></div>`).join('')}</div>
 ${STATIC?`<div class="box"><h3>ŽIVÁ DATA (GitHub Pages)</h3><p class="note">Skóre přímo z prohlížeče: Sofascore každé 1,5 s, 365scores 2 s, ESPN 3 s (při chybě/429 se interval zdvojnásobuje až na 30 s), Challenger/ITF bez bodů z 365scores se aktualizují jen z GitHub Actions, živé kurzy postupně (~1 zápas/0,7 s, cyklus ≥ 30 s). Odezva zdrojů (medián): ${Object.entries(SOURCES).map(([k,s])=>k+' '+(s.lat&&s.lat.length?Math.round([...s.lat].sort((a,b)=>a-b)[s.lat.length>>1]):'–')+' ms').join(', ')}. Předzápasové predikce: GitHub Actions, vygenerováno ${new Date(ST.generated*1000).toLocaleString('cs-CZ')}.</p></div>`:''}<div class="box" style="${STATIC?'display:none':''}"><h3>ŽIVÁ DATA</h3><p class="note">Poslední dotaz: ${S.status.last_poll||'–'} · stažení zdrojů ${S.status.source_ms} ms · celý cyklus ${S.status.poll_ms} ms · interval ${S.status.live?'3 s (živé zápasy)':'30 s'} · zpoždění SSE push→prohlížeč ${S.lat.length?Math.round(S.lat.at(-1))+' ms':'–'}</p></div>`}
function chatView(){return `<h1>CHAT</h1><div id="msgs"><div class="msg">Ahoj! Napiš dvojici hráčů, např. „Sinner vs Alcaraz antuka“. Odpovídám z modelu (lokální asistent, bez AI).</div></div>
 <div style="padding:12px;display:flex;gap:8px"><input class="q" id="cq" placeholder="Zpráva…"><button class="ob" id="cs">➤</button></div>`}
function playersView(){return `<h1>HRÁČI</h1><div style="padding:0 12px"><input class="q" id="ps" placeholder="Hledat hráče…"></div><div id="plist"></div>`}

async function render(){const v=$('#view');let h='';
 if(S.view==='zapasy')h=matchesView(false);else if(S.view==='oblibene')h=matchesView(true);else if(S.view==='predikce')h=await predView();
 else if(S.view==='model')h=await modelView();else if(S.view==='chat'){if(v.dataset.v==='chat')return;h=chatView()}else if(S.view==='hraci'){if(v.dataset.v==='hraci')return;h=playersView()}
 v.dataset.v=S.view;v.innerHTML=h;bind()}

function pickBox(inp,list,cb){let t;inp.oninput=()=>{clearTimeout(t);t=setTimeout(async()=>{const r=inp.value.length>1?await api('/api/players?q='+encodeURIComponent(inp.value)):[];
 list.innerHTML=r.slice(0,6).map(p=>`<div class="fac" data-id="${p.id}"><span>${esc(p.name)} <small class="na">${p.g==='M'?'muži':'ženy'}</small></span><span class="na">Elo ${p.elo}${p.rank?' · #'+p.rank:''}</span></div>`).join('');
 list.querySelectorAll('[data-id]').forEach(x=>x.onclick=()=>{inp.value=x.textContent.split('  ')[0];inp.dataset.id=x.dataset.id;list.innerHTML='';cb&&cb(x.dataset.id)})},250)}}

function bind(){document.querySelectorAll('.days button').forEach(b=>b.onclick=()=>{S.day=+b.dataset.day;if(!S.data[S.day])load(S.day);render()});
 $('#circ')&&($('#circ').onchange=e=>{S.circ=e.target.value;render()});$('#filt')&&($('#filt').onchange=e=>{S.filt=e.target.value;render()});
 $('#favt')&&($('#favt').onclick=()=>{S.favOnly=!S.favOnly;render()});
 document.querySelectorAll('.m[data-id]').forEach(x=>x.onclick=()=>openDetail(x.dataset.id));
 if(S.view==='predikce'){let surf='Hard';const go=async()=>{const a=$('#pa').dataset.id,b=$('#pb').dataset.id;if(!a||!b)return;
   const r=await api(`/api/predict?a=${a}&b=${b}&surface=${surf}`);$('#pres').innerHTML=`<div class="big2" style="margin-top:12px">${pct(r.p)} : ${pct(1-r.p)}</div><div class="note">Elo ${pct(r.elo_p)} · H2H ${r.h2h.join(':')} · fér kurzy ${f2(1/r.p)} / ${f2(1/(1-r.p))}</div>${r.factors.map(f=>`<div class="fac"><span>${f.label}</span><span class="${f.favors}">${f.favors==='A'?r.cards[0].name:r.cards[1].name}</span></div>`).join('')}`};
  pickBox($('#pa'),$('#pal'),go);pickBox($('#pb'),$('#pbl'),go);document.querySelectorAll('#psurf button').forEach(b=>b.onclick=()=>{surf=b.dataset.s;document.querySelectorAll('#psurf button').forEach(x=>x.classList.toggle('on',x===b));go()})}
 if(S.view==='hraci'){const i=$('#ps');let t;i.oninput=()=>{clearTimeout(t);t=setTimeout(async()=>{const r=i.value.length>1?await api('/api/players?q='+encodeURIComponent(i.value)):[];
  $('#plist').innerHTML='<div class="box">'+(r.map(p=>`<div class="fac"><span>${esc(p.name)} <small class="na">${p.g==='M'?'ATP/ITF':'WTA/ITF'}</small></span><span class="na">Elo ${p.elo} · ${p.rank?'#'+p.rank:'bez žebř.'} · ${p.matches} záp.</span></div>`).join('')||'<div class="note">Nic nenalezeno</div>')+'</div>'},250)}}
 if(S.view==='chat'){const send=async()=>{const q=$('#cq').value.trim();if(!q)return;$('#cq').value='';$('#msgs').insertAdjacentHTML('beforeend',`<div class="msg me">${esc(q)}</div>`);
  const r=await api('/api/chat?q='+encodeURIComponent(q));$('#msgs').insertAdjacentHTML('beforeend',`<div class="msg">${esc(r.answer)}</div>`)};$('#cs').onclick=send;$('#cq').onkeydown=e=>e.key==='Enter'&&send()}}

// ---- detail ----
async function openDetail(id,refresh){const d=await api('/api/match/'+encodeURIComponent(id));S.detail=d;if(!refresh)S.tab='prehled';drawDetail();if(!refresh)$('#detail').scrollTop=0}
function drawDetail(){const d=S.detail,el=$('#detail');el.classList.remove('hidden');const [A,B]=d.players;
 const sa=d.sets.filter((s,i)=>!(d.status==='live'&&i===d.sets.length-1)).filter(s=>s[0]>s[1]).length, sb=d.sets.filter((s,i)=>!(d.status==='live'&&i===d.sets.length-1)).filter(s=>s[1]>s[0]).length;
 const cur=d.status==='live'&&d.sets.length?d.sets.at(-1).join('–')+(d.pts_raw?` · gem ${d.pts_raw.map(x=>x==50?'A':x).join(':')}`:'')+(d.server?` · podává ${esc(shortN(d.players[d.server-1]))}`:''):'';const [tg,cl]=tagOf(d.circuit);const c=d.cards||[];
 const pp=(p,cd)=>`<div class="pp"><div class="av">${initials(p.name)}</div><b>${esc(shortN(p))}</b><small>${cd&&cd.rank?'#'+cd.rank:esc(p.country||'')}</small></div>`;
 let h=`<div class="dh"><button class="back" id="bk">‹</button><div class="tt"><b>${esc(d.tournament)}</b><small>${esc(d.circuit)} · ${surfCz[d.surface]||d.surface} · ${d.g==='M'?'Muži':'Ženy'}${d.qual?' · Kvalifikace':''}${d.round?' · '+esc(d.round):''}</small></div>${d.demo?'<span class="tag demo">DEMO</span>':''}<span class="tag ${cl}">${tg}</span></div>
 <div class="score">${pp(A,c[0])}<div class="mid"><div class="big">${sa}:${sb}</div><small>${cur}</small><small>${d.status==='live'?'<span class="livebadge">▶ živě</span>':d.status==='finished'?'Konec':new Date(d.ts*1000).toLocaleString('cs-CZ',{weekday:'short',hour:'2-digit',minute:'2-digit'})}</small>
 <button class="star ${S.fav.has(d.id)?'on':''}" id="fv" style="margin-top:8px;height:38px">${S.fav.has(d.id)?'★':'☆'}</button></div>${pp(B,c[1])}</div>
 <div class="tabs">${[['prehled','Přehled'],['predikce','Predikce'],['kurzy','Kurzy'],['h2h','H2H'],['stat','Statistiky']].map(([k,t])=>`<button data-t="${k}" class="${S.tab===k?'on':''}">${t}</button>`).join('')}</div>`;
 h+=({prehled:tPrehled,predikce:tPred,kurzy:tKurzy,h2h:tH2H,stat:tStat}[S.tab])(d);el.innerHTML=h;
 $('#bk').onclick=()=>{el.classList.add('hidden');S.detail=null};$('#fv').onclick=()=>{S.fav.has(d.id)?S.fav.delete(d.id):S.fav.add(d.id);saveFav();drawDetail()};
 el.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>{S.tab=b.dataset.t;drawDetail()});el.querySelectorAll('.seg button[data-who]').forEach(b=>b.onclick=()=>{S.who=b.dataset.who;drawDetail()})}
const sur=p=>{const n=p.name||'';return /\s\w\.$/.test(n)?n.replace(/\s\w\.$/,''):n.split(' ').slice(1).join(' ')||n};const nA=d=>sur(d.players[0]), nB=d=>sur(d.players[1]);
function bar2(p){return `<div class="bar"><span>${pct(p)}</span><div class="t"><i style="width:${p*100}%"></i></div><span>${pct(1-p)}</span></div>`}
function tPrehled(d){if(d.pred==null)return `<div class="box note">Pro tento zápas nemáme historii jednoho z hráčů – predikce není k dispozici.</div>`;
 let h='';if(d.live)h+=`<div class="box"><h3>ŽIVÁ PRAVDĚPODOBNOST VÝHRY</h3><div class="big2">${pct(d.live.match)} : ${pct(1-d.live.match)}</div>${bar2(d.live.match)}<p class="note">Markovův model z pravděpodobností bodu na podání (${pct(d.live.serve_a)} / ${pct(d.live.serve_b)}), stav setů a gemů. ${esc(d.live.note)}.</p>
  <div class="two"><div><div class="lbl">AKTUÁLNÍ SET</div><b>${pct(d.live.set)}</b></div>${d.live.game!=null?`<div><div class="lbl">AKTUÁLNÍ GEM</div><b>${pct(d.live.game)}</b></div>`:''}<div><div class="lbl">UDRŽENÍ PODÁNÍ</div><b>${pct(d.live.hold_a)} / ${pct(d.live.hold_b)}</b></div></div></div>`;
 h+=`<div class="box"><h3>PŘEDZÁPASOVÁ PREDIKCE MODELU</h3><div class="big2">${pct(d.pred)} : ${pct(1-d.pred)}</div>${bar2(d.pred)}<p class="note">LightGBM ${pct(d.pred)} · logistická regrese ${pct(d.pred_lr)} · Elo ${pct(d.elo_p)}</p></div>`;
 if(d.markov)h+=`<div class="box"><h3>PRAVDĚPODOBNOSTI GEMŮ A SETŮ</h3><table><tr><th></th><th>${esc(nA(d))}</th><th>${esc(nB(d))}</th></tr><tr><td>Bod na podání</td><td>${pct(d.markov.serve_a)}</td><td>${pct(d.markov.serve_b)}</td></tr><tr><td>Udržení podání (gem)</td><td>${pct(d.markov.hold_a)}</td><td>${pct(d.markov.hold_b)}</td></tr><tr><td>Výhra 1. setu</td><td>${pct(d.markov.set1)}</td><td>${pct(1-d.markov.set1)}</td></tr><tr><td>Zápas (na ${d.best_of} sety)</td><td>${pct(d.pred)}</td><td>${pct(1-d.pred)}</td></tr></table></div>`;
 return h}
function tPred(d){if(!d.cards||!d.cards[0]||!d.cards[1])return '<div class="box note">Predikce nedostupná.</div>';const [a,b]=d.cards;
 return `<div class="box note"><b>Predikce ${pct(d.live?d.live.match:d.pred)} : ${pct(1-(d.live?d.live.match:d.pred))}</b>. Před zápasem ${pct(d.pred)} : ${pct(1-d.pred)}. Rozpis faktorů je předzápasový.</div>
 <div class="box"><div class="note">${esc(d.circuit)} · ${surfCz[d.surface]} · na ${d.best_of} sety</div><h3 style="margin-top:10px">HLAVNÍ FAKTORY</h3>${(d.factors||[]).map(f=>`<div class="fac"><span>${f.label}</span><span class="${f.favors}">${'▮'.repeat(Math.min(4,1+Math.round(Math.abs(f.value)*6)))} ${esc(f.favors==='A'?a.name:b.name)}</span></div>`).join('')}
 <p class="note">Faktory = příspěvky v logistické regresi (vysvětlitelná část modelu); výsledná pravděpodobnost je z LightGBM.</p></div>
 <div class="box"><h3>SROVNÁNÍ</h3><table><tr><th></th><th>${esc(nA(d)).toUpperCase()}</th><th>${esc(nB(d)).toUpperCase()}</th></tr>
 <tr><td>Elo celkové</td><td>${a.elo}</td><td>${b.elo}</td></tr><tr><td>Elo – ${surfCz[d.surface]}</td><td>${a.selo}</td><td>${b.selo}</td></tr><tr><td>Žebříček</td><td>${a.rank??'–'}</td><td>${b.rank??'–'}</td></tr>
 <tr><td>Forma (výhry z posl. 10)</td><td>${a.form}</td><td>${b.form}</td></tr><tr><td>Zápasů celkem (od 1968)</td><td>${a.matches}</td><td>${b.matches}</td></tr><tr><td>Poslední zápas v datech</td><td>${a.last||'–'}</td><td>${b.last||'–'}</td></tr></table></div>`}
function tKurzy(d){const o=d.odds_table;if(!o.length)return `<div class="box note">Kurzy nedostupné: ${esc(d.odds_status)}. Kurzy nevymýšlíme.</div>`;
 const p=d.live?d.live.match:d.pred;let h=`<div class="box"><h3>KURZY SÁZKOVÝCH KANCELÁŘÍ</h3><table><tr><th>SÁZKOVKA</th><th>${esc(nA(d))}</th><th>${esc(nB(d))}</th><th>MARŽE</th></tr>`;
 for(const x of o){const m=1/x.a+1/x.b-1;h+=`<tr><td>${esc(x.bookmaker)}</td><td>${f2(x.a)}</td><td>${f2(x.b)}</td><td>${(m*100).toFixed(1)} %</td></tr>`}
 const ba=Math.max(...o.map(x=>x.a)),bb=Math.max(...o.map(x=>x.b)),fa=(1/ba)/((1/ba)+(1/bb));
 h+=`</table></div><div class="box"><h3>IMPLIKOVANÁ PRAVDĚPODOBNOST BEZ MARŽE</h3><div class="big2">${pct(fa)} : ${pct(1-fa)}</div>${bar2(fa)}<p class="note">Z nejlepších kurzů ${f2(ba)} / ${f2(bb)}, marže odstraněna normalizací.</p></div>`;
 if(p!=null){const ea=p*ba-1,eb=(1-p)*bb-1;h+=`<div class="box"><h3>VALUE (PRÁH 5 %)</h3><table><tr><th></th><th>MODEL</th><th>FÉR KURZ</th><th>EV</th></tr><tr><td>${esc(nA(d))}</td><td>${pct(p)}</td><td>${f2(1/p)}</td><td style="color:${ea>.05?'var(--grn)':'inherit'}">${(ea*100).toFixed(1)} %</td></tr><tr><td>${esc(nB(d))}</td><td>${pct(1-p)}</td><td>${f2(1/(1-p))}</td><td style="color:${eb>.05?'var(--grn)':'inherit'}">${(eb*100).toFixed(1)} %</td></tr></table><p class="note">Value = model × nejlepší kurz − 1 &gt; 5 %. Není to doporučení k sázce.</p></div>`}
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
function staticLoop(){const onCh=ids=>{for(const d of Object.keys(S.data))S.data[d]=ST.all.filter(m=>m.day===+d);upd();cacheSave();
  if(S.view==='zapasy'||S.view==='oblibene'){let full=ST.added;ST.added=false;
   if(!full)for(const id of ids){const el=document.querySelector(`.m[data-id="${CSS.escape(id)}"]`);const m=ST.byId[id];
     if(el&&m&&filt([m]).length){const t=document.createElement('div');t.innerHTML=card(m);const n=t.firstChild;n.onclick=()=>openDetail(id);el.replaceWith(n)}
     else if(m&&m.day===S.day&&filt([m]).length){full=true;break}}
   if(full)render();const lp=document.querySelector('h1 .pill');if(lp)lp.textContent=`● ${ST.all.filter(m=>m.status==='live').length} živě`}
  if(S.detail&&ids.includes(S.detail.id))openDetail(S.detail.id,true)};
 startSources(onCh);
 const odd=async()=>{const l=ST.all.filter(m=>m.status==='live'&&m.fs);for(const m of l){if(document.hidden)break;await oddsFor(m);await new Promise(r=>setTimeout(r,700))}onCh(l.map(m=>m.id));setTimeout(odd,30000)};setTimeout(odd,8000);
 setInterval(async()=>{_st0=loadStatic();await _st0;onCh([]);render()},300000)}
