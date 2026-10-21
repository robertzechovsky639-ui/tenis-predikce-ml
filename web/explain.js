'use strict';
// Vysvětlení tipu: proč model favorizuje hráče. Vstup = příspěvky faktorů (logistická regrese) + surové rozdíly A−B.
const Explain = (() => {
  const sig = z => 1 / (1 + Math.exp(-z));
  const SURF = { Hard: 'tvrdém povrchu', Clay: 'antuce', Grass: 'trávě', Carpet: 'koberci' };
  const n0 = x => Math.round(Math.abs(x)).toLocaleString('cs-CZ'), p1 = x => (Math.abs(x) * 100).toFixed(1).replace('.', ',');
  // text o surovém rozdílu z pohledu hráče, kterému faktor pomáhá (kdo = jméno, a = true když je to hráč A)
  function detail(key, raw, a, surf) {
    if (raw == null || !isFinite(raw)) return '';
    const r = a ? raw : -raw;  // rozdíl z pohledu zvýhodněného
    switch (key) {
      case 'elo_d': return `Elo o ${n0(r)} bodů ${r >= 0 ? 'vyšší' : 'nižší'}`;
      case 'selo_d': return `Elo na ${SURF[surf] || 'povrchu'} o ${n0(r)} bodů ${r >= 0 ? 'vyšší' : 'nižší'}`;
      case 'elo_p': return `Elo očekávání ${Math.round((a ? raw : 1 - raw) * 100)} %`;
      case 'logrank_d': { const f = Math.exp(Math.abs(raw)); return r >= 0 ? `v žebříčku ${f >= 1.95 ? f.toFixed(1).replace('.', ',') + '× ' : ''}výš` : `v žebříčku níž` }
      case 'form_d': return `forma o ${n0(r * 10)} ${Math.abs(r * 10) >= 1.5 && Math.abs(r * 10) < 4.5 ? 'výhry' : 'výher'} z 10 ${r >= 0 ? 'lepší' : 'horší'}`;
      case 'fat_d': return r < 0 ? `o ${n0(r)} zápas${Math.abs(r) >= 2 ? (Math.abs(r) >= 5 ? 'ů' : 'y') : ''} méně za 14 dní (odpočatější)` : `o ${n0(r)} zápasů víc za 14 dní (rozehranost)`;
      case 'inact_d': return r < 0 ? `o ${n0(r)} dní kratší pauza` : `o ${n0(r)} dní delší pauza`;
      case 'h2h_d': return r > 0 ? `vede vzájemné zápasy o ${n0(r)}` : r < 0 ? `prohrává vzájemné zápasy o ${n0(r)}` : 'vzájemné zápasy vyrovnané';
      case 'exp_d': return `poslední výsledky ${r >= 0 ? 'nad' : 'pod'} očekáváním (${p1(r)} b./zápas)`;
      case 'age_d': return `o ${n0(r)} ${Math.abs(r) < 1.5 ? 'rok' : Math.abs(r) < 4.5 ? 'roky' : 'let'} ${r >= 0 ? 'starší' : 'mladší'}`;
      case 'unc_d': return r >= 0 ? 'víc odehraných zápasů (spolehlivější rating)' : 'méně odehraných zápasů';
      case 'spw_d': return `o ${p1(r)} % víc bodů na podání`;
      case 'rpw_d': return `o ${p1(r)} % víc bodů na returnu`;
    } return '' }
  // factors: [{key,label,value(log-odds příspěvek),favors,raw}], p = výsledná pravděpodobnost A
  function rows(factors, p, names, surf, k = 6) {
    const z = Math.log(Math.max(p, 1e-6) / Math.max(1 - p, 1e-6));
    return (factors || []).filter(f => Math.abs(f.value) > .01).sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, k).map(f => {
      const a = f.value > 0, pp = Math.abs(sig(z) - sig(z - f.value)) * 100;  // o kolik proc. bodů faktor posouvá šanci
      let text = detail(f.key, f.raw, a, surf);
      // rozdíl jde proti zvýhodněnému (např. horší forma) – model ho bere jako výhodu až po započtení ostatních faktorů (hlavně Elo)
      if (text && /horší|nižší|níž\b/.test(text)) text += ' (po započtení Elo to model bere jako výhodu)';
      return { key: f.key, label: f.label, who: a ? names[0] : names[1], side: a ? 'A' : 'B', pp, text } }) }
  function summary(rs, p, names) {
    const fav = p >= .5 ? 'A' : 'B', nm = fav === 'A' ? names[0] : names[1], pro = rs.filter(r => r.side === fav), proti = rs.filter(r => r.side !== fav);
    if (!rs.length) return `Model mírně favorizuje: ${nm}.`;
    let s = `Tip: ${nm} (${Math.round(Math.max(p, 1 - p) * 100)} %). Hlavní důvody: ${pro.slice(0, 3).map(r => r.label).join(', ') || '–'}.`;
    if (proti.length) s += ` Proti mluví: ${proti.slice(0, 2).map(r => r.label).join(', ')}.`;
    return s }
  return { rows, summary, detail };
})();
if (typeof module !== 'undefined') module.exports = Explain;
