/* ============================================================
   Diario de Gastos — lógica de datos y render
   ============================================================ */

const STORAGE_KEY = 'diarioGastosDB_v1';
const UI_BUILD = 'gist-central-solo-gist-2026-08-23-fix3';
const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const MESES_ABR = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const FIJOS_REF_YEAR = 2026; // año de referencia del MASTER
const MASTER_URLS = [
  'https://javiap20.github.io/javi/excel/finanzas-master.xlsx',
  '../excel/finanzas-master.xlsx',
  './excel/finanzas-master.xlsx'
];
const BOOTSTRAP_VERSION = 4; // bootstrap manual: 2026/2027 se importan una vez desde botones
const MASTER_MAX_YEAR = 2040; // horizonte visible/proyectable desde el año base
const MASTER_REFRESH_PARAM = () => `?v=${Date.now()}`;
const MES_ABR_LOWER = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
const CONCEPT_ALIASES = { 'nom': 'nómina' }; // compatibilidad con plantillas antiguas
const MASTER_FREQUENCIES = new Set(['mensual','anual','semanal']);
const DEFAULT_SPECIAL_RULES = { ing:{ ingresoSemestral:4050, gastoNormal:675, mesesIngreso:[1,7], ultimoIngreso:'2034-01-01', cambioGasto:'2033-04-02', gastoReducido:304, finGasto:'2034-06-30' } };

// Gist central del dashboard. El ID es público; el token NUNCA se incluye en el JSON.
const GIST_ID = 'bcb12de9d4e6b476062a8d13a676532f';
const GIST_FILE = 'diario-gastos.json';
const GIST_RAW_URL = `https://gist.githubusercontent.com/javiap20/${GIST_ID}/raw/${GIST_FILE}`;
const GIST_API_URL = `https://api.github.com/gists/${GIST_ID}`;
const GIST_API_VERSION = '2026-03-10';
const GIST_TIMEOUT_MS = 12000;
const GIST_TOKEN_SESSION_KEY = 'diarioGastos_gistToken_session';
const GIST_TOKEN_LOCAL_KEY = 'diarioGastos_gistToken_local';
const GIST_REMEMBER_KEY = 'diarioGastos_gistToken_remember';
const GIST_LOCAL_SYNC_BACKUP_KEY = 'diarioGastos_gistLocalConflictBackup_v1';

const gistSync = {
  ready: false,
  suppress: false,
  token: null,
  rememberToken: false,
  timer: null,
  syncing: false,
  remoteUpdatedAt: null,
  lastStatus: null,
  // Solo se pone a true cuando esta pestaña ha leído el Gist con éxito en esta sesión.
  // El autoguardado NUNCA se activa si esto es false: así nunca se sube al Gist un
  // estado que no sepamos con certeza que parte de la última versión remota.
  loadedFromGist: false
};

let DB = loadDB();
let TEMPLATE_2027 = DB.template2027 || null;
let ui = {
  year: null,
  monthFilterDiario: 'todos',
  calendarMonth: null,
  tarjMonth: (new Date().getMonth()+1)
};

// ---------------- Storage ----------------
function loadDB(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw){
      const db = JSON.parse(raw);
      if(!db.ipc) db.ipc = { gastos:2, ingresos:0.5 };
      if(!db.fijos) db.fijos = [];
      if(!db.fijosGroups) db.fijosGroups = [];
      if(!('bootstrap' in db)) db.bootstrap = {version:0};
      if(!('template2027' in db)) db.template2027 = null;
      if(!('masterLoaded' in db)) db.masterLoaded = false;
      if(!db.syncMeta) db.syncMeta = {lastSyncedAt:null, forceLocalImport:false};
      if(!('lastSyncedAt' in db.syncMeta)) db.syncMeta.lastSyncedAt = null;
      if(!('forceLocalImport' in db.syncMeta)) db.syncMeta.forceLocalImport = false;
      if(!db.specialRules) db.specialRules = JSON.parse(JSON.stringify(DEFAULT_SPECIAL_RULES));
      if(!db.specialRules.ing) db.specialRules.ing = JSON.parse(JSON.stringify(DEFAULT_SPECIAL_RULES.ing));
      // Migración puntual: versiones anteriores llegaron a guardar 4.000 €
      // por una regla antigua; la regla acordada es 4.050 €.
      if(Number(db.specialRules.ing.ingresoSemestral)===4000) db.specialRules.ing.ingresoSemestral=4050;
      return db;
    }
  }catch(e){ console.error('Error leyendo almacenamiento', e); }
  return { years:{}, template2027:null, bootstrap:{version:0}, masterLoaded:false, syncMeta:{lastSyncedAt:null, forceLocalImport:false}, specialRules:JSON.parse(JSON.stringify(DEFAULT_SPECIAL_RULES)), fijos:[], ipc:{ gastos:2, ingresos:0.5 }, fijosGroups:[] };
}
function saveDB(options={}){
  const shouldSync = options.sync !== false;
  if(!DB.syncMeta) DB.syncMeta = {lastSyncedAt:null, forceLocalImport:false};
  if(gistSync.ready && shouldSync && !gistSync.suppress){
    DB.updatedAt = new Date().toISOString();
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(DB));
  if(gistSync.ready && shouldSync && !gistSync.suppress){
    scheduleGistSync();
  }
}
function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,7); }

function ensureYear(y){
  y = String(y);
  if(!DB.years[y]) DB.years[y] = { start:0, days:[], cardEntries:[] };
  return DB.years[y];
}

// ---------------- Utils ----------------
function fmt(n){
  if(n===null||n===undefined||isNaN(n)) return '0';
  n = Number(n);
  const neg = n<0;
  n = Math.abs(n);
  const intPart = Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (neg ? '−' : '') + intPart;
}
function fmtSigned(n){
  const s = fmt(Math.abs(n));
  return (n<0?'−':'+') + s;
}
// Formato editable con separador de miles (punto) y decimales opcionales (coma)
function fmtEditable(n){
  if(n===null||n===undefined||n===''||isNaN(n)) return '';
  return Number(n).toLocaleString('es-ES', {minimumFractionDigits:0, maximumFractionDigits:2});
}
// Convierte un texto en formato español (1.234,56) a número JS
function parseEsNumber(str){
  if(str===null||str===undefined) return 0;
  str = String(str).trim().replace(/−/g,'-');
  if(!str) return 0;
  str = str.replace(/\./g,'').replace(',', '.');
  const n = parseFloat(str);
  return isNaN(n) ? 0 : n;
}
function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._h);
  toast._h = setTimeout(()=>t.classList.remove('show'), 2600);
}
function parseDateISO(d){
  // d: JS Date or 'yyyy-mm-dd' string
  if(d instanceof Date) return d;
  return new Date(d+'T00:00:00');
}
function isoDate(d){
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

// ---------------- Cálculo de saldos ----------------
function getSortedDays(year){
  const yd = ensureYear(year);
  const entries = yd.days.slice();
  entries.sort((a,b)=> a.date < b.date ? -1 : (a.date > b.date ? 1 : 0));
  let running = yd.start||0;
  return entries.map(e=>{
    running += Number(e.amount)||0;
    return Object.assign({}, e, {balance: running});
  });
}

function monthlyAggregates(year){
  const yd = ensureYear(year);
  const sorted = getSortedDays(year);
  const months = [];
  let lastBalance = yd.start||0;
  for(let m=1;m<=12;m++){
    const dayEntries = sorted.filter(e=> parseDateISO(e.date).getMonth()+1 === m);
    const ingresos = dayEntries.filter(e=>Number(e.amount)>0).reduce((s,e)=>s+Number(e.amount),0);
    const gastosOtros = dayEntries.filter(e=>Number(e.amount)<0 && !/^tarjetas/i.test(e.concept||'')).reduce((s,e)=>s+Number(e.amount),0);
    const catEntries = yd.cardEntries.filter(c=>Number(c.month)===m);
    const tarjeta = catEntries.reduce((s,c)=>s+Number(c.amount||0),0);
    const saldoFin = dayEntries.length ? dayEntries[dayEntries.length-1].balance : lastBalance;
    lastBalance = saldoFin;
    months.push({m, ingresos, gastosOtros, tarjeta, saldoFin, count:dayEntries.length});
  }
  return months;
}

function yearTotals(year){
  const yd = ensureYear(year);
  const sorted = getSortedDays(year);
  const ingresos = sorted.filter(e=>Number(e.amount)>0).reduce((s,e)=>s+Number(e.amount),0);
  const gastos = sorted.filter(e=>Number(e.amount)<0).reduce((s,e)=>s+Number(e.amount),0);
  const tarjeta = yd.cardEntries.reduce((s,c)=>s+Number(c.amount||0),0);
  const saldoFinal = sorted.length ? sorted[sorted.length-1].balance : (yd.start||0);
  return { start: yd.start||0, saldoFinal, ingresos, gastos, ahorro: ingresos+gastos, tarjeta };
}

// ============================================================
// RENDER: shell (year select, tabs, ticker)
// ============================================================
function populateYearSelect(){
  const sel = document.getElementById('yearSelect');
  const set = new Set(Object.keys(DB.years).map(Number));
  if(DB.fijos && DB.fijos.length){
    // Solo se añaden al selector los años de Gastos Fijos >= FIJOS_REF_YEAR
    // (2026 en adelante); columnas de referencia anteriores (p.ej. 2025)
    // no aparecen aquí, aunque sigan visibles en la pestaña Gastos fijos.
    fijosYears().filter(y=>y>=FIJOS_REF_YEAR).forEach(y=>set.add(Number(y)));
  }
  // Orden: año actual en adelante primero (ascendente), y los años ya
  // pasados van al final del selector (también ascendente entre ellos).
  const currentYear = new Date().getFullYear();
  const allYears = Array.from(set).sort((a,b)=>a-b);
  const futuros = allYears.filter(y=>y>=currentYear);
  const pasados = allYears.filter(y=>y<currentYear);
  const years = [...futuros, ...pasados].map(String);
  sel.innerHTML = years.map(y=>`<option value="${y}">${y}${DB.years[y]?'':' (sin datos)'}</option>`).join('');
  // Selección por defecto (al entrar): el año actual si existe en la lista;
  // si no, el primero disponible. Solo se aplica si aún no hay selección
  // válida (no pisa una elección manual del usuario durante la sesión).
  if(!ui.year || !years.includes(ui.year)){
    ui.year = years.includes(String(currentYear)) ? String(currentYear) : (years.length ? years[0] : null);
  }
  if(ui.year) sel.value = ui.year;
}

function renderTicker(){
  const box = document.getElementById('tickerBox');
  const yearLabel = document.getElementById('tickerYear');
  const valEl = document.getElementById('tickerValue');
  const deltaEl = document.getElementById('tickerDelta');
  if(!ui.year){
    yearLabel.textContent = '—'; valEl.textContent='0'; deltaEl.textContent='';
    box.innerHTML = '<div class="ticker-empty">Importa un Excel o añade movimientos para ver la evolución del saldo.</div>';
    return;
  }
  yearLabel.textContent = ui.year;
  const sorted = getSortedDays(ui.year);
  const start = ensureYear(ui.year).start||0;
  const finalBal = sorted.length ? sorted[sorted.length-1].balance : start;
  valEl.textContent = fmt(finalBal);
  const delta = finalBal - start;
  deltaEl.textContent = ` ${fmtSigned(delta)} € en el año`;
  deltaEl.style.color = delta>=0 ? '#8FE3C0' : '#F0B39F';

  if(!sorted.length){
    box.innerHTML = '<div class="ticker-empty">Sin movimientos todavía para '+ui.year+'.</div>';
    return;
  }
  // build step points across the year
  const points = [{x: new Date(Number(ui.year),0,1).getTime(), y:start}];
  sorted.forEach(e=> points.push({x: parseDateISO(e.date).getTime(), y:e.balance}));
  const W=1000,H=64,PAD=4;
  const minX = points[0].x, maxX = points[points.length-1].x;
  const ys = points.map(p=>p.y);
  let minY = Math.min(...ys, start), maxY = Math.max(...ys, start);
  if(minY===maxY){ minY-=1; maxY+=1; }
  const sx = x => PAD + (W-2*PAD) * ( (x-minX) / Math.max(1,(maxX-minX)) );
  const sy = y => H-PAD - (H-2*PAD) * ( (y-minY) / (maxY-minY) );
  // step-after path
  let d = `M ${sx(points[0].x).toFixed(1)} ${sy(points[0].y).toFixed(1)}`;
  for(let i=1;i<points.length;i++){
    d += ` L ${sx(points[i].x).toFixed(1)} ${sy(points[i-1].y).toFixed(1)}`;
    d += ` L ${sx(points[i].x).toFixed(1)} ${sy(points[i].y).toFixed(1)}`;
  }
  const lastX = sx(points[points.length-1].x), lastY = sy(points[points.length-1].y);
  const areaD = d + ` L ${lastX.toFixed(1)} ${H-PAD} L ${sx(points[0].x).toFixed(1)} ${H-PAD} Z`;
  const zeroY = sy(0);
  const zeroLine = (0>=minY && 0<=maxY) ? `<line x1="0" y1="${zeroY.toFixed(1)}" x2="${W}" y2="${zeroY.toFixed(1)}" stroke="#3A473F" stroke-width="1" stroke-dasharray="3,3"/>` : '';
  box.innerHTML = `<svg class="ticker-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    ${zeroLine}
    <path d="${areaD}" fill="rgba(201,146,46,0.16)" stroke="none"/>
    <path d="${d}" fill="none" stroke="#C9922E" stroke-width="1.6" vector-effect="non-scaling-stroke"/>
    <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="2.6" fill="#F5F8F4"/>
  </svg>`;
}

// ============================================================
// RENDER: Resumen
// ============================================================
function renderResumen(){
  const kpiRow = document.getElementById('kpiRow');
  const sub = document.getElementById('resumenSub');
  const chartBox = document.getElementById('monthChart');
  if(!ui.year){
    kpiRow.innerHTML = emptyKpis();
    sub.textContent = '';
    chartBox.innerHTML = emptyState('Sin datos', 'Importa tu Excel o crea un año para empezar.');
    return;
  }
  const t = yearTotals(ui.year);
  sub.textContent = ui.year;
  kpiRow.innerHTML = `
    ${kpiCard('Saldo inicial', fmt(t.start)+' €','')}
    ${kpiCard('Saldo final', fmt(t.saldoFinal)+' €', t.saldoFinal>=t.start?'pos':'neg')}
    ${kpiCard('Ingresos', fmt(t.ingresos)+' €','pos')}
    ${kpiCard('Gastos', fmt(t.gastos)+' €','neg')}
    ${kpiCard('Ahorro neto', fmtSigned(t.ahorro)+' €', t.ahorro>=0?'pos':'neg')}
    ${kpiCard('Gasto tarjeta', fmt(t.tarjeta)+' €','card')}
  `;
  const months = monthlyAggregates(ui.year);
  chartBox.innerHTML = buildMonthChartSVG(months);
}
function emptyKpis(){
  return ['Saldo inicial','Saldo final','Ingresos','Gastos','Ahorro neto','Gasto tarjeta']
    .map(l=>kpiCard(l,'—','')).join('');
}
function kpiCard(label,value,cls){
  return `<div class="kpi ${cls||''}"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div></div>`;
}
function emptyState(title,sub){
  return `<div class="empty-state"><div class="big">·</div><div><strong>${title}</strong></div><div>${sub}</div></div>`;
}

function buildMonthChartSVG(months){
  const W=900,H=280, padL=34,padR=10,padT=14,padB=26;
  const innerW = W-padL-padR, innerH = H-padT-padB;
  const slot = innerW/12;
  const maxBar = Math.max(1, ...months.map(m=>Math.max(m.ingresos, Math.abs(m.gastosOtros), m.tarjeta)));
  const saldos = months.map(m=>m.saldoFin);
  let minS = Math.min(...saldos), maxS = Math.max(...saldos);
  if(minS===maxS){minS-=1;maxS+=1;}
  const barW = slot/4;
  let bars='', line='';
  const pts=[];
  months.forEach((m,i)=>{
    const cx = padL + slot*i + slot/2;
    const baseY = padT+innerH;
    const hIng = (m.ingresos/maxBar)*innerH;
    const hGasto = (Math.abs(m.gastosOtros)/maxBar)*innerH;
    const hTarj = (m.tarjeta/maxBar)*innerH;
    const x0 = cx - slot/2 + slot*0.12;
    bars += rect(x0, baseY-hIng, barW*0.9, hIng, 'var(--pos)');
    bars += rect(x0+barW, baseY-hGasto, barW*0.9, hGasto, 'var(--neg)');
    bars += rect(x0+barW*2, baseY-hTarj, barW*0.9, hTarj, 'var(--card)');
    const sy = padT + innerH - ((m.saldoFin-minS)/(maxS-minS))*innerH;
    pts.push([cx, sy]);
  });
  line = 'M ' + pts.map(p=>p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' L ');
  const dots = pts.map(p=>`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.6" fill="var(--gold)"/>`).join('');
  const labels = months.map((m,i)=>`<text x="${(padL+slot*i+slot/2).toFixed(1)}" y="${H-8}" font-size="10.5" fill="var(--ink-soft)" text-anchor="middle" font-family="Inter,sans-serif">${MESES_ABR[i]}</text>`).join('');
  return `<svg class="chart-svg" viewBox="0 0 ${W} ${H}">
    <line x1="${padL}" y1="${padT+innerH}" x2="${W-padR}" y2="${padT+innerH}" stroke="var(--line)" stroke-width="1"/>
    ${bars}
    <path d="${line}" fill="none" stroke="var(--gold)" stroke-width="1.8"/>
    ${dots}
    ${labels}
  </svg>`;
}
function rect(x,y,w,h,fill){
  if(h<0){ y=y+h; h=Math.abs(h); }
  h = Math.max(h,0.6);
  return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="${fill}"/>`;
}

// ============================================================
// RENDER: Diario
// ============================================================
function monthFilterLabel(){
  if(!ui.year) return '—';
  if(ui.monthFilterDiario==='todos') return String(ui.year);
  return `${MESES[Number(ui.monthFilterDiario)-1]} ${ui.year}`;
}
function calendarBaseMonth(){
  const y=Number(ui.year)||new Date().getFullYear();
  if(ui.calendarMonth && ui.calendarMonth.year===y) return ui.calendarMonth.month;
  if(ui.monthFilterDiario!=='todos') return Number(ui.monthFilterDiario);
  return y===new Date().getFullYear() ? new Date().getMonth()+1 : 1;
}
function renderCalendarPopover(){
  const pop=document.getElementById('calendarPopover');
  if(!pop) return;
  const y=Number(ui.year);
  if(!y){
    document.getElementById('calendarNavLabel').textContent='—';
    document.getElementById('calTitle').textContent='—';
    document.getElementById('calendarDays').innerHTML='';
    return;
  }
  const m=calendarBaseMonth();
  ui.calendarMonth={year:y,month:m};
  document.getElementById('calendarNavLabel').textContent=monthFilterLabel();
  document.getElementById('calTitle').textContent=`${MESES[m-1]} ${y}`;
  const first=new Date(y,m-1,1);
  const daysIn=new Date(y,m,0).getDate();
  const mondayIndex=(first.getDay()+6)%7;
  const prevDays=new Date(y,m-1,0).getDate();
  let html='';
  for(let i=0;i<42;i++){
    const day=i-mondayIndex+1;
    let yy=y, mm=m, dd=day, muted=false;
    if(day<1){ dd=prevDays+day; mm=m-1; muted=true; if(mm<1){mm=12;yy--;}}
    else if(day>daysIn){ dd=day-daysIn; mm=m+1; muted=true; if(mm>12){mm=1;yy++;}}
    const iso=`${yy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
    const today=iso===isoDate(new Date());
    const selectedMonth=ui.monthFilterDiario!=='todos' && Number(ui.monthFilterDiario)===mm && yy===y;
    const cls=[muted?'muted':'',today?'today':'',selectedMonth&&!muted?'selected':''].filter(Boolean).join(' ');
    html+=`<button type="button" class="${cls}" data-cal-date="${iso}" data-cal-year="${yy}" data-cal-month="${mm}">${dd}</button>`;
  }
  document.getElementById('calendarDays').innerHTML=html;
  document.getElementById('calAll').textContent=`Ver todo ${y}`;
}
function populateMonthFilter(){
  renderCalendarPopover();
}
function renderDiario(){
  const wrap = document.getElementById('diarioTableWrap');
  if(!ui.year){ wrap.innerHTML = emptyState('Sin año seleccionado','Crea o importa un año primero.'); return; }
  let sorted = getSortedDays(ui.year);
  if(ui.monthFilterDiario!=='todos'){
    sorted = sorted.filter(e=> parseDateISO(e.date).getMonth()+1 === Number(ui.monthFilterDiario));
  }
  // Las filas sin concepto siguen existiendo internamente, pero no ocupan espacio visual.
  sorted = sorted.filter(e=> String(e.concept||'').trim() !== '');
  if(!sorted.length){
    wrap.innerHTML = emptyState('Sin movimientos','No hay movimientos para este filtro.');
    return;
  }

  const currentYear = new Date().getFullYear();
  const isYearActual = Number(ui.year) === currentYear;
  const todayIso = isoDate(new Date());
  const todayMonth = new Date().getMonth()+1;
  const monthFilter = ui.monthFilterDiario==='todos' ? null : Number(ui.monthFilterDiario);

  // Solo el año actual empieza en el mes actual.
  // Los años futuros o pasados siempre se muestran de enero a diciembre.
  // Si hay filtro mensual, se muestra solo ese mes.
  const monthOrder = monthFilter
    ? [monthFilter]
    : (isYearActual
        ? Array.from({length:12},(_,i)=>((todayMonth-1+i)%12)+1)
        : MESES.map((_,i)=>i+1));

  const groups = new Map();
  monthOrder.forEach(m=>groups.set(m,[]));
  sorted.forEach(e=>{
    const m = parseDateISO(e.date).getMonth()+1;
    if(!groups.has(m)) groups.set(m,[]);
    groups.get(m).push(e);
  });

  // Dentro del año actual, solo las fechas anteriores a hoy se consideran archivadas.
  // En años distintos al actual se conserva el comportamiento anterior: todo editable y activo.
  const isArchived = e => isYearActual && e.date < todayIso;

  const rowHtml = (e, archived)=>{
    const cls = Number(e.amount)>=0 ? 'amount-pos':'amount-neg';
    return `<tr data-id="${e.id}"${archived?' class="fila-archivada"':''}>
      <td><input class="row-input mono" type="date" value="${e.date}" data-field="date"></td>
      <td><input class="row-input" type="text" value="${escapeHtml(e.concept||'')}" data-field="concept"></td>
      <td class="num-cell"><input class="row-input num mono ${cls}" type="text" inputmode="decimal" value="${fmt(e.amount)}" data-field="amount"></td>
      <td class="num-cell mono balance-cell ${Number(e.balance)<0?'neg':''}">${fmt(e.balance)} €</td>
      <td style="width:30px"><button class="icon-btn" data-del="${e.id}" title="Eliminar">✕</button></td>
    </tr>`;
  };

  let bodyHtml = '';
  let archiveHeaderShown = false;

  monthOrder.forEach(m=>{
    const items = (groups.get(m)||[]).slice().sort((a,b)=>a.date<b.date?-1:(a.date>b.date?1:0));
    if(!items.length) return;

    bodyHtml += `<tr class="diario-month-row"><td colspan="5">${MESES[m-1]}</td></tr>`;

    if(isYearActual){
      const activos = items.filter(e=>!isArchived(e));
      const archivados = items.filter(e=>isArchived(e));

      bodyHtml += activos.map(e=>rowHtml(e,false)).join('');
      if(archivados.length){
        // Un único separador global antes del primer bloque histórico.
        if(!archiveHeaderShown){
          bodyHtml += `<tr class="diario-archivo-sep"><td colspan="5">Archivado · movimientos anteriores a hoy (no se recalculan automáticamente)</td></tr>`;
          archiveHeaderShown = true;
        }
        bodyHtml += archivados.map(e=>rowHtml(e,true)).join('');
      }
    } else {
      bodyHtml += items.map(e=>rowHtml(e,false)).join('');
    }
  });

  wrap.innerHTML = `<table>
    <thead><tr><th style="width:130px">Fecha</th><th>Concepto</th><th style="width:140px">Importe</th><th style="width:160px">Saldo</th><th></th></tr></thead>
    <tbody>${bodyHtml}</tbody>
  </table>`;

  wrap.querySelectorAll('input[data-field]').forEach(inp=>{
    inp.addEventListener('change', e=>{
      e.target.blur();
      const tr = e.target.closest('tr');
      const id = tr.getAttribute('data-id');
      const field = e.target.getAttribute('data-field');
      const yd = ensureYear(ui.year);
      const entry = yd.days.find(x=>x.id===id);
      if(!entry) return;
      entry[field] = field==='amount' ? parseEsNumber(e.target.value) : e.target.value;
      saveDB();
      renderAll();
    });
  });
  wrap.querySelectorAll('button[data-del]').forEach(btn=>{
    btn.addEventListener('click', e=>{
      const id = e.target.getAttribute('data-del');
      if(!confirm('¿Eliminar este movimiento?')) return;
      const yd = ensureYear(ui.year);
      yd.days = yd.days.filter(x=>x.id!==id);
      saveDB();
      renderAll();
      toast('Movimiento eliminado');
    });
  });
}
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ============================================================
// RENDER: Tarjeta
// ============================================================
function populateTarjMonthSelect(){
  const sel = document.getElementById('tarjMonthSelect');
  sel.innerHTML = MESES.map((m,i)=>`<option value="${i+1}">${m}</option>`).join('');
  sel.value = ui.tarjMonth;
}
function isCalendarMonthClosed(year, month){
  const y=Number(year), m=Number(month);
  const currentYear=new Date().getFullYear();
  if(y>currentYear) return false;
  const todayIso=isoDate(new Date());
  const lastDayIso=isoDate(new Date(y, m, 0));
  return lastDayIso < todayIso;
}

function syncTarjetaMonthToDiario(year, month, force=false){
  const y=Number(year), m=Number(month);
  const currentYear = new Date().getFullYear();
  if(!force){
    if(y < currentYear) return false;
    if(y === currentYear && isCalendarMonthClosed(y,m)) return false;
  }

  const yd=ensureYear(y);
  const concept=`Tarjetas ${MESES_ABR[m-1]}`;
  const normConcept = s => String(s||'').trim().toLowerCase();
  const total=yd.cardEntries.filter(c=>Number(c.month)===m)
    .reduce((s,c)=>s+Number(c.amount||0),0);
  const matches=[];
  yd.days.forEach((d,i)=>{
    if(normConcept(d.concept)===normConcept(concept) || /^tarjetas\s+/i.test(String(d.concept||'')) && normConcept(d.concept)===normConcept(concept)) matches.push(i);
  });
  if(total===0){
    for(let i=matches.length-1;i>=0;i--) yd.days.splice(matches[i],1);
    return matches.length>0;
  }
  const dateIso=isoDate(new Date(y,m,0));
  let keepIndex = matches.length ? matches[0] : -1;
  if(keepIndex<0){
    yd.days.push({id:uid(),date:dateIso,concept,amount:-total,source:'card-total',sourceTemplate2027:true,sourceCalculation:'card-total'});
  }else{
    const d=yd.days[keepIndex];
    d.amount=-total; d.date=dateIso; d.concept=concept;
    d.source='card-total'; d.sourceTemplate2027=true; d.sourceCalculation='card-total';
    for(let i=matches.length-1;i>=1;i--) yd.days.splice(matches[i],1);
  }
  return true;
}

function syncAllOpenTarjetasToDiario(year){
  const y=Number(year);
  const yd=ensureYear(y);
  for(let m=1;m<=12;m++) syncTarjetaMonthToDiario(y,m,false);
}

function reconcileFutureYearStarts(){
  let changed=false;
  const years=Object.keys(DB.years||{}).map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  years.forEach(year=>{
    if(year<=FIJOS_REF_YEAR) return;
    const prevYear=DB.years[String(year-1)];
    if(!prevYear) return;
    const prevSorted=getSortedDays(year-1);
    const expectedStart=prevSorted.length ? prevSorted[prevSorted.length-1].balance : (prevYear.start||0);
    const yd=ensureYear(year);
    if(Number(yd.start||0)!==Number(expectedStart||0)){
      yd.start=Number(expectedStart||0);
      changed=true;
    }
  });
  return changed;
}

function cardEntryType(entry){
  if(entry && (entry.type==='vacaciones' || entry.type==='gasto')) return entry.type;
  const category=String(entry?.category||'');
  if(typeof masterMatchesForTemplate==='function'){
    const matches=masterMatchesForTemplate(category,'tarjeta')||[];
    if(matches.some(x=>x.tipo==='vacaciones')) return 'vacaciones';
  }
  return 'gasto';
}
function setCardCategoryType(year, month, category, type){
  const yd=ensureYear(year);
  const norm=normalizeName(category);
  yd.cardEntries.forEach(c=>{
    if(Number(c.month)===Number(month) && normalizeName(c.category)===norm){
      c.type=type==='vacaciones'?'vacaciones':'gasto';
      c.manualType=true;
    }
  });
}

function renderTarjeta(){
  document.getElementById('tarjMonthLabel').textContent = ui.year ? MESES[ui.tarjMonth-1] : '—';
  const catBox = document.getElementById('catBars');
  const monthlyBox = document.getElementById('tarjMonthlyWrap');
  if(!ui.year){
    catBox.innerHTML = emptyState('Sin año','Selecciona un año primero.');
    monthlyBox.innerHTML='';
    return;
  }
  const yd = ensureYear(ui.year);
  const entries = yd.cardEntries.filter(c=>Number(c.month)===Number(ui.tarjMonth));
  if(!entries.length){
    catBox.innerHTML = emptyState('Sin gastos de tarjeta', 'Añade uno o importa el Excel.');
  } else {
    const byCat = {};
    entries.forEach(e=>{ byCat[e.category] = (byCat[e.category]||0) + Number(e.amount||0); });
    const list = Object.entries(byCat).sort((a,b)=>b[1]-a[1]);
    const max = Math.max(...list.map(x=>x[1]));
    const entryByCategory = new Map();
    entries.forEach(e=>{ if(!entryByCategory.has(e.category)) entryByCategory.set(e.category, e); });
    catBox.innerHTML = list.map(([cat,val])=>{
      const entry = entryByCategory.get(cat);
      const safeId = entry ? entry.id : '';
      return `
      <div style="margin-bottom:11px;">
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:12.5px;margin-bottom:4px;gap:10px;">
          <span style="display:inline-flex;align-items:center;gap:7px;">${escapeHtml(cat)}${entry && cardEntryType(entry)==='vacaciones'?'<span class="badge" style="background:#FFF0E2;color:#C65D0E;">Vacaciones</span>':''}</span>
          <span style="display:inline-flex;align-items:center;gap:7px;">
            <select class="field" data-card-type="${safeId}" style="padding:4px 7px;font-size:11px;">
              <option value="gasto" ${!entry || cardEntryType(entry)==='gasto'?'selected':''}>Gasto</option>
              <option value="vacaciones" ${entry && cardEntryType(entry)==='vacaciones'?'selected':''}>Vacaciones</option>
            </select>
            <input class="row-input card-amount-input num mono" type="text" inputmode="decimal" value="${fmt(val)}" data-card-id="${safeId}" title="Importe editable">
            <button class="icon-btn" data-card-del="${safeId}" title="Eliminar gasto de tarjeta" aria-label="Eliminar ${escapeHtml(cat)}">✕</button>
          </span>
        </div>
        <div style="background:var(--panel-alt);border-radius:5px;height:8px;overflow:hidden;">
          <div style="background:var(--card);height:100%;width:${(val/max*100).toFixed(1)}%;"></div>
        </div>
      </div>`;
    }).join('');
    catBox.innerHTML += `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--line);display:flex;justify-content:space-between;font-weight:600;">
      <span>Total</span><span class="mono">${fmt(list.reduce((s,[,v])=>s+v,0))} €</span></div>`;

    catBox.querySelectorAll('select[data-card-type]').forEach(sel=>{
      sel.addEventListener('change', e=>{
        const id=e.target.getAttribute('data-card-type');
        const entry=yd.cardEntries.find(c=>c.id===id);
        if(!entry) return;
        setCardCategoryType(ui.year, entry.month, entry.category, e.target.value);
        saveDB(); renderAll();
        toast('Tipo de gasto actualizado');
      });
    });
    catBox.querySelectorAll('button[data-card-del]').forEach(btn=>{
      btn.addEventListener('click', e=>{
        const id=e.currentTarget.getAttribute('data-card-del');
        const entry=yd.cardEntries.find(c=>c.id===id);
        if(!entry) return;
        if(!confirm(`¿Eliminar ${entry.category} de ${MESES[Number(entry.month)-1]}?`)) return;
        const month=Number(entry.month);
        yd.cardEntries=yd.cardEntries.filter(c=>c.id!==id);
        syncTarjetaMonthToDiario(ui.year, month, true);
        saveDB();
        renderAll();
        toast('Gasto de tarjeta eliminado');
      });
    });
    catBox.querySelectorAll('input[data-card-id]').forEach(inp=>{
      inp.addEventListener('change', e=>{
        e.target.blur();
        const id=e.target.getAttribute('data-card-id');
        const entry=yd.cardEntries.find(c=>c.id===id);
        if(!entry) return;
        entry.amount=parseEsNumber(e.target.value);
        entry.manualEdit=true;
        entry.sourceCalculation='manual';
        const month = Number(entry.month);
        syncTarjetaMonthToDiario(ui.year, month, true);
        saveDB();
        renderAll();
        toast('Importe de tarjeta actualizado y Diario sincronizado');
      });
    });
  }
  const monthAgg = monthlyAggregates(ui.year);
  monthlyBox.innerHTML = `<table>
    <thead><tr><th>Mes</th><th class="num-cell">Total tarjeta</th></tr></thead>
    <tbody>${monthAgg.map(m=>`<tr><td>${MESES[m.m-1]}</td><td class="num-cell mono">${fmt(m.tarjeta)} €</td></tr>`).join('')}</tbody>
  </table>`;
}

// ============================================================
// RENDER: Gastos fijos
// ============================================================
function fijosYears(){
  const set = new Set();
  DB.fijos.forEach(f=> Object.keys(f.values||{}).forEach(y=>set.add(Number(y))));
  if(DB.masterLoaded){
    for(let y=FIJOS_REF_YEAR; y<=MASTER_MAX_YEAR; y++) set.add(y);
  }
  if(!set.size){
    const base = ui.year ? Number(ui.year) : new Date().getFullYear();
    for(let i=0;i<6;i++) set.add(base+i);
  }
  return Array.from(set).sort((a,b)=>a-b);
}

function masterGroupId(group){
  return 'master:' + String(group||'sinGrupo').trim();
}

function parseMasterRows(rows){
  if(!Array.isArray(rows) || !rows.length) return [];
  const header = rows[0].map(v=>String(v==null?'':v).trim().toLowerCase());
  const idx = {};
  header.forEach((h,i)=>{ if(h) idx[h]=i; });
  const required = ['id','tipo','grupo','concepto','valor_base','ano_base','frecuencia','meses','medio','activo','orden'];
  if(required.some(k=>idx[k]===undefined)) return [];

  const items = [];
  for(const row of rows.slice(1)){
    const id = row[idx.id];
    const concepto = row[idx.concepto];
    if(id==null || concepto==null) continue;
    const tipoRaw = String(row[idx.tipo]??'').trim().toLowerCase();
    if(tipoRaw!=='ingreso' && tipoRaw!=='gasto') continue;
    const base = Number(row[idx.valor_base]);
    const anoBase = Number(row[idx.ano_base]) || FIJOS_REF_YEAR;
    const frecuenciaRaw = String(row[idx.frecuencia]??'').trim().toLowerCase();
    const frecuencia = MASTER_FREQUENCIES.has(frecuenciaRaw) ? frecuenciaRaw : 'mensual';
    const mesesRaw = row[idx.meses];
    const meses = mesesRaw==null || String(mesesRaw).trim()==='' ? [] : String(mesesRaw).split('|').map(x=>Number(x.trim())).filter(m=>m>=1&&m<=12);
    const medio = String(row[idx.medio]??'cuenta').trim().toLowerCase()==='tarjeta' ? 'tarjeta' : 'cuenta';
    const activo = Number(row[idx.activo]) !== 0;
    const grupo = String(row[idx.grupo]??'').trim();
    const orden = Number(row[idx.orden]) || 9999;
    if(!Number.isFinite(base)) continue;
    items.push({
      id:String(id),
      name:String(concepto).trim(),
      tipo: grupo==='gastosVacaciones' ? 'vacaciones' : tipoRaw,
      groupId: masterGroupId(grupo),
      masterGroup: grupo,
      masterId:String(id),
      masterTipo:tipoRaw,
      frecuencia,
      meses,
      medio,
      activo,
      orden,
      source:'master',
      values:{[anoBase]:base}
    });
  }
  return items;
}

function buildMasterGroups(items){
  const existing = Array.isArray(DB.fijosGroups) ? DB.fijosGroups.filter(g=>!String(g.id||'').startsWith('master:')) : [];
  const seen = new Map();
  items.forEach((item,i)=>{
    if(!seen.has(item.groupId)) seen.set(item.groupId, {id:item.groupId,name:item.masterGroup||'Sin grupo',order:i});
  });
  DB.fijosGroups = [...seen.values(), ...existing];
}

function installMasterItems(items){
  if(!items.length) return false;
  const manual = (DB.fijos||[]).filter(f=>f.source!=='master');
  DB.fijos = [...items, ...manual];
  buildMasterGroups(items);
  DB.masterLoaded = true;
  DB.masterLoadedAt = new Date().toISOString();
  items.forEach(item=>{
    item.values = item.values || {};
    const baseYear = Object.keys(item.values).map(Number).sort((a,b)=>a-b)[0] || FIJOS_REF_YEAR;
    recomputeForwardFijo(item, baseYear);
  });
  return true;
}

function masterMonths(item, year){
  if(!item || !item.activo) return [];
  if(item.frecuencia==='mensual') return Array.from({length:12},(_,i)=>i+1);
  if(item.frecuencia==='anual') return item.meses.length ? item.meses : [1];
  if(item.frecuencia==='semanal') return Array.from({length:12},(_,i)=>i+1);
  return item.meses.length ? item.meses : [1];
}

function daysInMonth(year,month){ return new Date(year, month, 0).getDate(); }
function countFridaysInBillingMonth(year, month){
  // Mes financiero para partidas semanales: del dia 22 del mes anterior
  // al dia 21 del mes indicado, ambos inclusive. Cada viernes cuenta como
  // una semana. Enero, por tanto, empieza el 22 de diciembre del año anterior.
  const start = new Date(Date.UTC(Number(year), Number(month)-2, 22));
  const end = new Date(Date.UTC(Number(year), Number(month)-1, 21));
  let count = 0;
  for(let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate()+1)){
    if(d.getUTCDay()===5) count++; // viernes
  }
  return count;
}
function monthlyBudgetForMaster(item, year, month){
  const unit = Math.abs(Number(item?.values?.[year])||0);
  if(!item || !item.activo) return 0;
  if(item.frecuencia==='mensual') return unit;
  if(item.frecuencia==='anual') return item.meses.includes(month) ? unit : 0;
  if(item.frecuencia==='semanal') return unit * countFridaysInBillingMonth(year, month);
  return item.meses.includes(month) ? unit : 0;
}

function ipcRateFor(tipo){
  const cfg = DB.ipc || { gastos:2, ingresos:0.5 };
  if(tipo==='ingreso') return Number(cfg.ingresos)||0;
  if(tipo==='puntual') return 0;
  return Number(cfg.gastos)||0; // gasto y vacaciones usan el IPC de gastos
}
// Recalcula en cascada los años POSTERIORES a fromYear, usando el valor de fromYear como base
function recomputeForwardFijo(item, fromYear){
  const rate = ipcRateFor(item.tipo);
  const years = fijosYears().filter(y=>y>fromYear).sort((a,b)=>a-b);
  let prev = Number(item.values[fromYear]);
  if(isNaN(prev)) return;
  years.forEach(y=>{
    prev = prev * (1 + rate/100);
    item.values[y] = Math.round(prev*100)/100;
  });
}
function ensureGroupsArr(){
  if(!DB.fijosGroups) DB.fijosGroups = [];
  return DB.fijosGroups;
}
function sortedGroups(){
  return [...ensureGroupsArr()].sort((a,b)=> a.name.localeCompare(b.name, 'es'));
}
function moveFijoGroup(id, dir){
  const arr = ensureGroupsArr();
  const idx = arr.findIndex(g=>g.id===id);
  if(idx<0) return;
  const newIdx = idx+dir;
  if(newIdx<0 || newIdx>=arr.length) return;
  const tmp = arr[idx]; arr[idx]=arr[newIdx]; arr[newIdx]=tmp;
  saveDB(); renderFijos();
}
function deleteFijoGroup(id){
  if(!confirm('¿Eliminar este grupo? Las partidas pasarán a "Sin grupo".')) return;
  DB.fijos.forEach(f=>{ if(f.groupId===id) f.groupId=null; });
  DB.fijosGroups = ensureGroupsArr().filter(g=>g.id!==id);
  saveDB(); renderFijos();
}
// Elimina una columna de año entera de Gastos fijos (p.ej. una columna de
// referencia colada al importar, como 2025), borrando ese valor de todas
// las partidas. Si el año es el FIJOS_REF_YEAR o posterior, avisa de que
// afecta a la proyección con IPC.
function deleteFijosYear(year){
  const y = Number(year);
  const msg = y>=FIJOS_REF_YEAR
    ? `El año ${y} se usa como referencia/proyección de Gastos fijos. ¿Seguro que quieres eliminar esta columna?`
    : `¿Eliminar la columna ${y} de Gastos fijos? Se borrará ese importe en todas las partidas.`;
  if(!confirm(msg)) return;
  DB.fijos.forEach(f=>{ if(f.values) delete f.values[y]; });
  sincronizarDiarioConFijos();
  saveDB(); renderAll();
  toast(`Columna ${y} eliminada de Gastos fijos`);
}

function renderFijos(){
  const wrap = document.getElementById('fijosTableWrap');
  const years = fijosYears();
  if(!DB.fijos.length){
    wrap.innerHTML = emptyState('Sin gastos fijos','Importa la hoja "Gastos" del Excel o añade una partida.');
    return;
  }
  const groups = ensureGroupsArr();
  const groupsAz = sortedGroups();
  const totalCols = 3 + years.length + 1; // partida+tipo+grupo + años + borrar
  const head = years.map(y=>`<th class="num-cell">${y}${y>FIJOS_REF_YEAR?' *':''} <button class="icon-btn" data-del-year="${y}" title="Eliminar columna ${y}" style="font-size:11px;padding:1px 3px;">✕</button></th>`).join('');

  function rowHtml(f){
    const tipo = ['ingreso','vacaciones','puntual'].includes(f.tipo) ? f.tipo : 'gasto';
    const rowCls = tipo==='ingreso' ? 'fijos-row-ingreso' : 'fijos-row-gasto';
    const isMaster = f.source==='master';
    const lock = isMaster ? ' disabled title="Gestionado desde finanzas-master.xlsx"' : '';
    const cells = years.map(y=>`<td class="num-cell"><input class="row-input num mono" type="text" inputmode="decimal" data-year="${y}" value="${f.values && f.values[y]!==undefined ? fmt(f.values[y]) : ''}"${lock}></td>`).join('');
    return `<tr data-id="${f.id}" class="${rowCls}">
      <td><input class="row-input" type="text" value="${escapeHtml(f.name)}" data-field="name"${lock}></td>
      <td><select class="row-input" data-field="tipo"${lock}>
        <option value="gasto" ${tipo==='gasto'?'selected':''}>Gasto</option>
        <option value="ingreso" ${tipo==='ingreso'?'selected':''}>Ingreso</option>
        <option value="vacaciones" ${tipo==='vacaciones'?'selected':''}>Vacaciones</option>
        <option value="puntual" ${tipo==='puntual'?'selected':''}>Puntual</option>
      </select></td>
      <td><select class="row-input" data-field="groupId"${lock}>
        <option value="">Sin grupo</option>
        ${groupsAz.map(g=>`<option value="${g.id}" ${f.groupId===g.id?'selected':''}>${escapeHtml(g.name)}</option>`).join('')}
      </select></td>
      ${cells}
      <td style="width:30px"><button class="icon-btn" data-del="${f.id}">✕</button></td>
    </tr>`;
  }
  function groupHeaderHtml(g, idx){
    return `<tr class="fijos-group-row">
      <td colspan="${totalCols}">
        <div class="fijos-group-inner">
          <span class="fijos-group-actions">
            <button class="icon-btn" data-group-up="${g.id}" title="Subir grupo" ${idx===0?'disabled':''}>▲</button>
            <button class="icon-btn" data-group-down="${g.id}" title="Bajar grupo" ${idx===groups.length-1?'disabled':''}>▼</button>
            <button class="icon-btn" data-group-del="${g.id}" title="Eliminar grupo">✕</button>
          </span>
          <input class="fijos-group-name-input" type="text" value="${escapeHtml(g.name)}" data-group-rename="${g.id}">
        </div>
      </td>
    </tr>`;
  }

  let bodyHtml = '';
  groups.forEach((g,idx)=>{
    const items = DB.fijos.filter(f=>f.groupId===g.id);
    bodyHtml += groupHeaderHtml(g, idx);
    bodyHtml += items.length
      ? items.map(rowHtml).join('')
      : `<tr class="fijos-group-empty"><td colspan="${totalCols}">Sin partidas en este grupo.</td></tr>`;
  });
  const ungrouped = DB.fijos.filter(f=> !f.groupId || !groups.some(g=>g.id===f.groupId));
  if(ungrouped.length){
    if(groups.length) bodyHtml += `<tr class="fijos-group-row"><td colspan="${totalCols}"><span class="fijos-group-name-static">Sin grupo</span></td></tr>`;
    bodyHtml += ungrouped.map(rowHtml).join('');
  }

  const totalsGastos = years.map(y=>{
    const t = DB.fijos.filter(f=>f.tipo!=='ingreso').reduce((s,f)=> s + Number((f.values&&f.values[y])||0), 0);
    return `<td class="num-cell mono" style="font-weight:600">${fmt(t)} €</td>`;
  }).join('');
  const totalsIngresos = years.map(y=>{
    const t = DB.fijos.filter(f=>f.tipo==='ingreso').reduce((s,f)=> s + Number((f.values&&f.values[y])||0), 0);
    return `<td class="num-cell mono" style="font-weight:600">${fmt(t)} €</td>`;
  }).join('');
  const totalsNeto = years.map(y=>{
    const gastos = DB.fijos.filter(f=>f.tipo!=='ingreso').reduce((s,f)=> s + Number((f.values&&f.values[y])||0), 0);
    const ingresos = DB.fijos.filter(f=>f.tipo==='ingreso').reduce((s,f)=> s + Number((f.values&&f.values[y])||0), 0);
    const neto = ingresos - gastos;
    return `<td class="num-cell mono ${neto>=0?'amount-pos':'amount-neg'}" style="font-weight:700">${fmt(neto)} €</td>`;
  }).join('');
  wrap.innerHTML = `<table>
    <thead><tr><th>Partida</th><th>Tipo</th><th>Grupo</th>${head}<th></th></tr></thead>
    <tbody>${bodyHtml}<tr class="fijos-gap-row"><td colspan="${totalCols}"></td></tr></tbody>
    <tfoot>
      <tr class="fijos-total-gastos"><td style="font-weight:600">Total gastos<br><span style="font-weight:400;font-size:10.5px">(gasto+vac.+puntual)</span></td><td></td><td></td>${totalsGastos}<td></td></tr>
      <tr class="fijos-total-ingresos"><td style="font-weight:600">Total ingresos<br><span style="font-weight:400;font-size:10.5px">(ingreso)</span></td><td></td><td></td>${totalsIngresos}<td></td></tr>
      <tr class="fijos-total-neto"><td style="font-weight:700">Neto<br><span style="font-weight:400;font-size:10.5px">(ingresos − gastos)</span></td><td></td><td></td>${totalsNeto}<td></td></tr>
    </tfoot>
  </table>
  <div class="fijos-note">* Años proyectados automáticamente desde ${FIJOS_REF_YEAR} según el IPC de gastos/ingresos.</div>`;

  wrap.querySelectorAll('input[data-field="name"]').forEach(inp=>{
    inp.addEventListener('change', e=>{
      const id = e.target.closest('tr').getAttribute('data-id');
      const item = DB.fijos.find(x=>x.id===id);
      if(item){ item.name = e.target.value; saveDB(); }
    });
  });
  wrap.querySelectorAll('select[data-field="tipo"]').forEach(sel=>{
    sel.addEventListener('change', e=>{
      const id = e.target.closest('tr').getAttribute('data-id');
      const item = DB.fijos.find(x=>x.id===id);
      if(!item) return;
      item.tipo = e.target.value;
      recomputeForwardFijo(item, FIJOS_REF_YEAR);
      sincronizarDiarioConFijos();
      saveDB(); renderAll();
    });
  });
  wrap.querySelectorAll('select[data-field="groupId"]').forEach(sel=>{
    sel.addEventListener('change', e=>{
      const id = e.target.closest('tr').getAttribute('data-id');
      const item = DB.fijos.find(x=>x.id===id);
      if(!item) return;
      item.groupId = e.target.value || null;
      saveDB(); renderFijos();
    });
  });
  wrap.querySelectorAll('input[data-year]').forEach(inp=>{
    inp.addEventListener('change', e=>{
      const id = e.target.closest('tr').getAttribute('data-id');
      const item = DB.fijos.find(x=>x.id===id);
      if(!item) return;
      item.values = item.values||{};
      const y = Number(e.target.getAttribute('data-year'));
      item.values[y] = parseEsNumber(e.target.value);
      recomputeForwardFijo(item, y);
      sincronizarDiarioConFijos();
      saveDB();
      renderAll();
    });
  });
  wrap.querySelectorAll('button[data-del]').forEach(btn=>{
    btn.addEventListener('click', e=>{
      if(!confirm('¿Eliminar esta partida?')) return;
      const id = e.target.getAttribute('data-del');
      DB.fijos = DB.fijos.filter(x=>x.id!==id);
      sincronizarDiarioConFijos();
      saveDB(); renderAll();
    });
  });
  wrap.querySelectorAll('button[data-del-year]').forEach(btn=>{
    btn.addEventListener('click', e=>{
      deleteFijosYear(e.target.getAttribute('data-del-year'));
    });
  });
  wrap.querySelectorAll('input[data-group-rename]').forEach(inp=>{
    inp.addEventListener('change', e=>{
      const id = e.target.getAttribute('data-group-rename');
      const g = ensureGroupsArr().find(x=>x.id===id);
      if(!g) return;
      const nuevo = e.target.value.trim();
      if(!nuevo){ e.target.value = g.name; return; }
      g.name = nuevo;
      saveDB(); renderFijos();
    });
  });
  wrap.querySelectorAll('button[data-group-up]').forEach(btn=>{
    btn.addEventListener('click', e=> moveFijoGroup(e.target.getAttribute('data-group-up'), -1));
  });
  wrap.querySelectorAll('button[data-group-down]').forEach(btn=>{
    btn.addEventListener('click', e=> moveFijoGroup(e.target.getAttribute('data-group-down'), 1));
  });
  wrap.querySelectorAll('button[data-group-del]').forEach(btn=>{
    btn.addEventListener('click', e=> deleteFijoGroup(e.target.getAttribute('data-group-del')));
  });
}

// ============================================================
// MODALES
// ============================================================
function openModal(html, onOpen){
  document.getElementById('modalBody').innerHTML = html;
  document.getElementById('modalBackdrop').classList.add('active');
  if(onOpen) onOpen();
}
function closeModal(){
  document.getElementById('modalBackdrop').classList.remove('active');
}
document.getElementById('modalBackdrop').addEventListener('click', e=>{
  if(e.target.id==='modalBackdrop') closeModal();
});

function modalAddMovimiento(){
  const today = isoDate(new Date());
  const groups = sortedGroups();
  const fijoOptions = groups.map(g=>{
    const items = DB.fijos.filter(f=>f.groupId===g.id);
    if(!items.length) return '';
    return `<optgroup label="${escapeHtml(g.name)}">${items.map(f=>`<option value="${f.id}">${escapeHtml(f.name)}</option>`).join('')}</optgroup>`;
  }).join('');
  const ungrouped = DB.fijos.filter(f=> !f.groupId || !groups.some(g=>g.id===f.groupId));
  const ungroupedOptions = ungrouped.length
    ? `<optgroup label="Sin grupo">${ungrouped.map(f=>`<option value="${f.id}">${escapeHtml(f.name)}</option>`).join('')}</optgroup>`
    : '';
  openModal(`
    <h3>Nuevo movimiento</h3>
    <div class="field-row"><label>Fecha</label><input class="field" type="date" id="mFecha" value="${today}"></div>
    <div class="field-row"><label>Partida de Gastos fijos (opcional)</label>
      <select class="field" id="mFijoSelect">
        <option value="">— Concepto manual —</option>
        ${fijoOptions}${ungroupedOptions}
      </select>
    </div>
    <div class="field-row"><label>Concepto</label><input class="field" type="text" id="mConcepto" placeholder="Ej. Supermercado"></div>
    <div class="field-row"><label>Importe (negativo = gasto)</label><input class="field" type="number" step="0.01" id="mImporte" placeholder="-45.30"></div>
    <div class="modal-actions">
      <button class="btn ghost" id="mCancel">Cancelar</button>
      <button class="btn primary" id="mSave">Guardar</button>
    </div>
  `, ()=>{
    function aplicarFijo(){
      const id = document.getElementById('mFijoSelect').value;
      if(!id) return;
      const item = DB.fijos.find(f=>f.id===id);
      if(!item) return;
      document.getElementById('mConcepto').value = item.name;
      const fechaVal = document.getElementById('mFecha').value;
      const year = fechaVal ? new Date(fechaVal+'T00:00:00').getFullYear() : new Date().getFullYear();
      const val = item.values && item.values[year]!==undefined ? Number(item.values[year]) : null;
      if(val!==null){
        const signed = item.tipo==='ingreso' ? Math.abs(val) : -Math.abs(val);
        document.getElementById('mImporte').value = signed;
      } else {
        toast(`Esa partida no tiene importe para ${year}, revisa a mano`);
      }
    }
    document.getElementById('mFijoSelect').addEventListener('change', e=>{
      if(!e.target.value){
        document.getElementById('mConcepto').value = '';
        document.getElementById('mImporte').value = '';
        return;
      }
      aplicarFijo();
    });
    document.getElementById('mFecha').addEventListener('change', aplicarFijo);
    document.getElementById('mCancel').onclick = closeModal;
    document.getElementById('mSave').onclick = ()=>{
      const fecha = document.getElementById('mFecha').value;
      const concepto = document.getElementById('mConcepto').value.trim();
      const importe = Number(document.getElementById('mImporte').value);
      if(!fecha || !importe){ toast('Falta fecha o importe'); return; }
      const y = new Date(fecha+'T00:00:00').getFullYear();
      const yd = ensureYear(y);
      yd.days.push({id:uid(), date:fecha, concept:concepto, amount:importe});
      if(String(y)!==ui.year){ ui.year = String(y); }
      saveDB(); closeModal(); renderAll();
      toast('Movimiento añadido');
    };
  });
}

function modalAddCategoria(){
  openModal(`
    <h3>Nuevo gasto de tarjeta</h3>
    <div class="field-row"><label>Mes</label>
      <select class="field" id="cMes">${MESES.map((m,i)=>`<option value="${i+1}" ${i+1===Number(ui.tarjMonth)?'selected':''}>${m}</option>`).join('')}</select>
    </div>
    <div class="field-row"><label>Categoría</label><input class="field" type="text" id="cCategoria" placeholder="Ej. Comida"></div>
    <div class="field-row"><label>Tipo</label><select class="field" id="cTipo"><option value="gasto" selected>Gasto</option><option value="vacaciones">Vacaciones</option></select></div>
    <div class="field-row"><label>Importe</label><input class="field" type="number" step="0.01" id="cImporte" placeholder="45.30"></div>
    <div class="modal-actions">
      <button class="btn ghost" id="cCancel">Cancelar</button>
      <button class="btn primary" id="cSave">Guardar</button>
    </div>
  `, ()=>{
    document.getElementById('cCancel').onclick = closeModal;
    document.getElementById('cSave').onclick = ()=>{
      const mes = Number(document.getElementById('cMes').value);
      const categoria = document.getElementById('cCategoria').value.trim();
      const importe = Number(document.getElementById('cImporte').value);
      const tipo = document.getElementById('cTipo').value==='vacaciones'?'vacaciones':'gasto';
      if(!categoria || !importe){ toast('Falta categoría o importe'); return; }
      const yd = ensureYear(ui.year);
      yd.cardEntries.push({id:uid(), month:mes, category:categoria, amount:importe, type:tipo, manualType:true});
      saveDB(); closeModal(); renderAll();
      toast('Gasto de tarjeta añadido');
    };
  });
}

function modalAddFijo(){
  const groups = sortedGroups();
  openModal(`
    <h3>Nueva partida fija</h3>
    <div class="field-row"><label>Nombre</label><input class="field" type="text" id="fNombre" placeholder="Ej. Gimnasio"></div>
    <div class="field-row"><label>Tipo</label>
      <select class="field" id="fTipo">
        <option value="gasto">Gasto</option>
        <option value="ingreso">Ingreso</option>
        <option value="vacaciones">Vacaciones</option>
        <option value="puntual">Puntual</option>
      </select>
    </div>
    <div class="field-row"><label>Grupo</label>
      <select class="field" id="fGrupo">
        <option value="">Sin grupo</option>
        ${groups.map(g=>`<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('')}
        <option value="__new__">+ Nuevo grupo…</option>
      </select>
    </div>
    <div class="field-row" id="fGrupoNuevoRow" style="display:none"><label>Nombre del grupo nuevo</label><input class="field" type="text" id="fGrupoNuevo" placeholder="Ej. Casa"></div>
    <div class="field-row"><label>Importe en ${FIJOS_REF_YEAR} (año de referencia)</label><input class="field" type="number" step="0.01" id="fImporte" placeholder="30"></div>
    <div class="modal-actions">
      <button class="btn ghost" id="fCancel">Cancelar</button>
      <button class="btn primary" id="fSave">Guardar</button>
    </div>
  `, ()=>{
    document.getElementById('fGrupo').addEventListener('change', e=>{
      document.getElementById('fGrupoNuevoRow').style.display = e.target.value==='__new__' ? '' : 'none';
    });
    document.getElementById('fCancel').onclick = closeModal;
    document.getElementById('fSave').onclick = ()=>{
      const nombre = document.getElementById('fNombre').value.trim();
      const tipo = document.getElementById('fTipo').value;
      const importe = Number(document.getElementById('fImporte').value)||0;
      const grupoSel = document.getElementById('fGrupo').value;
      if(!nombre){ toast('Falta el nombre'); return; }
      let groupId = null;
      if(grupoSel==='__new__'){
        const nuevoNombre = document.getElementById('fGrupoNuevo').value.trim();
        if(nuevoNombre){
          const g = {id:uid(), name:nuevoNombre};
          ensureGroupsArr().push(g);
          groupId = g.id;
        }
      } else if(grupoSel){
        groupId = grupoSel;
      }
      const item = { id:uid(), name:nombre, tipo, groupId, values:{} };
      item.values[FIJOS_REF_YEAR] = importe;
      recomputeForwardFijo(item, FIJOS_REF_YEAR);
      DB.fijos.push(item);
      sincronizarDiarioConFijos();
      saveDB(); closeModal(); renderAll();
      toast('Partida añadida');
    };
  });
}

function modalAddGroup(){
  openModal(`
    <h3>Nuevo grupo</h3>
    <div class="field-row"><label>Nombre</label><input class="field" type="text" id="gNombre" placeholder="Ej. Casa"></div>
    <div class="modal-actions">
      <button class="btn ghost" id="gCancel">Cancelar</button>
      <button class="btn primary" id="gSave">Crear</button>
    </div>
  `, ()=>{
    document.getElementById('gCancel').onclick = closeModal;
    document.getElementById('gSave').onclick = ()=>{
      const nombre = document.getElementById('gNombre').value.trim();
      if(!nombre){ toast('Falta el nombre'); return; }
      ensureGroupsArr().push({id:uid(), name:nombre});
      saveDB(); closeModal(); renderFijos();
      toast('Grupo creado');
    };
  });
}

function modalIPC(){
  const cfg = DB.ipc || { gastos:2, ingresos:0.5 };
  openModal(`
    <h3>IPC de proyección</h3>
    <div class="field-row"><label>IPC Gastos (%)</label><input class="field" type="number" step="0.1" id="ipcGastos" value="${cfg.gastos}"></div>
    <div class="field-row"><label>IPC Ingresos (%)</label><input class="field" type="number" step="0.1" id="ipcIngresos" value="${cfg.ingresos}"></div>
    <div style="font-size:12px;color:var(--ink-soft);margin-top:-4px;margin-bottom:4px;">Se aplica cada año a partir de ${FIJOS_REF_YEAR}, sobre el valor del año anterior.</div>
    <div class="modal-actions">
      <button class="btn ghost" id="ipcCancel">Cancelar</button>
      <button class="btn primary" id="ipcSave">Guardar</button>
    </div>
  `, ()=>{
    document.getElementById('ipcCancel').onclick = closeModal;
    document.getElementById('ipcSave').onclick = ()=>{
      const g = Number(document.getElementById('ipcGastos').value);
      const i = Number(document.getElementById('ipcIngresos').value);
      DB.ipc = { gastos: isNaN(g)?2:g, ingresos: isNaN(i)?0.5:i };
      DB.fijos.forEach(item=> recomputeForwardFijo(item, FIJOS_REF_YEAR));
      sincronizarDiarioConFijos();
      saveDB(); closeModal(); renderAll();
      toast('IPC actualizado');
    };
  });
}

// ============================================================
// GENERAR AÑO DESDE PLANTILLA (estructura fija de conceptos/días
// y bloques de tarjeta, tomada de un Excel de referencia; los
// importes siempre se recalculan en vivo desde Gastos Fijos)
// ============================================================

// ---- Utilidades de emparejamiento de nombres con Gastos Fijos ----
function normalizeName(s){
  return String(s||'').trim().toLowerCase();
}
function stripMonthSuffix(name){
  const parts = String(name||'').trim().split(/\s+/);
  if(parts.length>=2){
    const last = parts[parts.length-1].toLowerCase();
    if(MES_ABR_LOWER.includes(last)){
      return parts.slice(0,-1).join(' ');
    }
  }
  return null;
}
// Busca en DB.fijos una partida cuyo nombre coincida (exacto, o el nombre
// sin el sufijo de mes, p.ej. "Nom Ene" -> "Nom" -> alias "Nómina").
// Si no encuentra nada, devuelve null (=> importe 0).
function findFijoMatch(rawName){
  const norm = normalizeName(rawName);
  let item = DB.fijos.find(f=> normalizeName(f.name)===norm);
  if(item) return item;
  const base = stripMonthSuffix(rawName);
  if(base){
    const baseNorm = normalizeName(base);
    const aliased = CONCEPT_ALIASES[baseNorm] || baseNorm;
    item = DB.fijos.find(f=> normalizeName(f.name)===aliased);
    if(item) return item;
  }
  return null;
}
// Importe con signo para el Diario: ingreso => positivo, resto => negativo
// (misma convención que ya usa el modal "Nuevo movimiento").
function fijoAmountForYear(item, year){
  if(!item || !item.values) return 0;
  const val = Number(item.values[year]);
  if(isNaN(val)) return 0;
  return item.tipo==='ingreso' ? Math.abs(val) : -Math.abs(val);
}
// Importe sin signo para bloques de Tarjeta (siempre magnitud de gasto).
function fijoMagnitudeForYear(item, year){
  if(!item || !item.values) return 0;
  const val = Number(item.values[year]);
  if(isNaN(val)) return 0;
  return Math.abs(val);
}

// ============================================================
// PLANTILLA 2027+ — estructura externa en excel/2027.xlsx
// La plantilla NO se embebe en HTML/JS ni se guarda como plantilla
// maestra en el JSON. Se carga desde el archivo Excel cuando hace falta.
// ============================================================
function normalizeTemplateKey(s){
  return normalizeName(String(s||'').trim());
}

function templateMasterIds(concept, medium){
  const k = normalizeTemplateKey(concept);
  if(medium==='tarjeta'){
    // Cloud tiene dos partidas distintas en MASTER; usamos sus IDs estables
    // para no depender del nombre visible y evitar duplicaciones.
    if(k==='cloud') return ['gas_cloud_anual'];
    if(k==='cloud apple') return ['gas_cloud_mensual'];
  }
  return [];
}

function templateMasterAliases(concept, medium){
  const k = normalizeTemplateKey(concept);
  const aliases = [];
  if(medium==='cuenta'){
    if(/^nom/.test(k)) aliases.push(normalizeName('Nómina'));
    if(/^extra/.test(k)) aliases.push(normalizeName('Paga Extra'));
    if(k===normalizeName('Casa Mad')) aliases.push(normalizeName('Casa Madrid'));
    if(k===normalizeName('Regalo Navidad')) aliases.push(normalizeName('Regalo Navidad Niños'));
  }else if(medium==='tarjeta'){
    const map = {
      'semsanta':'Semana Santa',
      'fin de año':'Fin Año',
      'seguro':'Seguro Coche',
      'revisión':'Revisión Coche',
      'numerito':'Numerito Coche'
    };
    if(map[k]) aliases.push(normalizeTemplateKey(map[k]));
  }
  return aliases;
}

function masterMatchesForTemplate(concept, medium){
  const wantedIds = templateMasterIds(concept, medium);
  if(wantedIds.length){
    const byId = DB.fijos.filter(f=>f.source==='master' && f.activo && f.medio===medium && wantedIds.includes(String(f.masterId)));
    if(byId.length) return byId;
  }
  const exact = DB.fijos.filter(f=>f.source==='master' && f.activo && f.medio===medium && normalizeTemplateKey(f.name)===normalizeTemplateKey(concept));
  if(exact.length) return exact;
  const aliases = templateMasterAliases(concept, medium);
  for(const alias of aliases){
    const matches = DB.fijos.filter(f=>f.source==='master' && f.activo && f.medio===medium && normalizeTemplateKey(f.name)===alias);
    if(matches.length) return matches;
  }
  return [];
}

function ingRules(){
  if(!DB.specialRules) DB.specialRules = JSON.parse(JSON.stringify(DEFAULT_SPECIAL_RULES));
  if(!DB.specialRules.ing) DB.specialRules.ing = JSON.parse(JSON.stringify(DEFAULT_SPECIAL_RULES.ing));
  return DB.specialRules.ing;
}

function dateOnlyMs(iso){ const d=parseDateISO(iso); return isNaN(d.getTime())?NaN:d.getTime(); }

function amountForIng(date, year, incomeDates, concept){
  const r=ingRules();
  const t=dateOnlyMs(date), lastIncome=dateOnlyMs(r.ultimoIngreso), change=dateOnlyMs(r.cambioGasto), end=dateOnlyMs(r.finGasto);
  const key=normalizeTemplateKey(concept);
  if(!Number.isFinite(t)) return {include:false,amount:0,source:'special'};

  // ING INGRESO = ingreso semestral; ING = gasto periódico.
  // Nunca debemos aplicar el ingreso semestral a una fila ING normal aunque
  // compartan la misma fecha en la plantilla.
  if(key==='ing ingreso'){
    if(incomeDates && incomeDates.has(date) && Number.isFinite(lastIncome) && t<=lastIncome){
      return {include:true,amount:Math.abs(Number(r.ingresoSemestral)||0),source:'special'};
    }
    return {include:false,amount:0,source:'special'};
  }

  if(key==='ing'){
    if(Number.isFinite(change) && Number.isFinite(end) && t>=change && t<=end){
      return {include:true,amount:-Math.abs(Number(r.gastoReducido)||0),source:'special'};
    }
    if(Number.isFinite(lastIncome) && t<=lastIncome){
      return {include:true,amount:-Math.abs(Number(r.gastoNormal)||0),source:'special'};
    }
  }
  return {include:false,amount:0,source:'special'};
}

function amountForTemplateDay(concept, date, year, incomeDates=null){
  const key=normalizeTemplateKey(concept);
  if(key==='ing' || key==='ing ingreso') return amountForIng(date,year,incomeDates,concept);
  const matches=masterMatchesForTemplate(concept,'cuenta');
  if(!matches.length) return {include:false,amount:0,source:'unmatched'};
  let total=0;
  const m=parseDateISO(date).getMonth()+1;
  // Regla especial Casa Madrid: en octubre-diciembre de cada año se usa
  // el importe del año siguiente, porque la actualización de la renta
  // entra en vigor en ese tramo final del año.
  const budgetYear = (normalizeTemplateKey(concept)==='casa mad' && m>=10) ? Number(year)+1 : Number(year);
  for(const item of matches){
    total += monthlyBudgetForMaster(item,budgetYear,m);
  }
  if(Math.abs(total)<1e-9) return {include:false,amount:0,source:'inactive'};
  const tipo=matches[0].tipo;
  return {include:true,amount:tipo==='ingreso'?Math.abs(total):-Math.abs(total),source:'master'};
}

function amountForTemplateCard(category, year, month){
  const matches=masterMatchesForTemplate(category,'tarjeta');
  if(!matches.length) return {include:false,amount:0,source:'unmatched'};
  let total=0;
  for(const item of matches) total += monthlyBudgetForMaster(item,year,month);
  if(Math.abs(total)<1e-9) return {include:false,amount:0,source:'inactive'};
  return {include:true,amount:Math.abs(total),source:'master'};
}

function templateMatchInfo(){
  const accountNames = Array.from(new Set((TEMPLATE_2027?.days||[]).map(x=>x.concept).filter(Boolean)));
  const accountInfo = accountNames.map(name=>({concept:name,matches:masterMatchesForTemplate(name,'cuenta')}));
  const cardNames = Array.from(new Set((TEMPLATE_2027?.cardEntries||[]).map(x=>x.category).filter(Boolean)));
  const cardInfo = cardNames.map(name=>({concept:name,matches:masterMatchesForTemplate(name,'tarjeta')}));
  return {accountInfo,cardInfo};
}

function setBootstrapStatus(msg, ok=null){
  const el=document.getElementById('bootstrapStatus');
  if(!el) return;
  el.textContent=msg;
  el.style.color = ok===false ? 'var(--neg)' : (ok===true ? 'var(--pos)' : 'var(--ink-soft)');
}

function bootstrapStateText(){
  const hasMaster = !!DB.masterLoaded && Array.isArray(DB.fijos) && DB.fijos.some(f=>f.source==='master');
  return `Base: 2026 ${hasManual2026()?'✓':'—'} · estructura 2027 ${hasManual2027()?'✓':'—'} · MASTER ${hasMaster?'✓':'—'}`;
}

function templateDayKey(year, day, concept){ return String(year)+String(day.date).slice(4)+'|'+String(concept||''); }
function templateCardKey(month, category){ return String(month)+'|'+normalizeTemplateKey(category); }

function nearestTemplateDateForMonth(year, month, candidates){
  const arr=Array.isArray(candidates)?candidates.filter(Boolean):[];
  if(!arr.length) return null;
  const target=new Date(Number(year), Number(month)-1, 1).getTime();
  let best=null, bestDist=Infinity;
  arr.forEach(iso=>{
    const d=dateOnlyMs(iso);
    if(!Number.isFinite(d)) return;
    const dist=Math.abs(d-target);
    if(dist<bestDist || (dist===bestDist && String(iso)<String(best||''))){
      best=String(iso); bestDist=dist;
    }
  });
  return best;
}

function generateIngIncomeDates(year, templateDays){
  const all=(templateDays||[]).filter(t=>{
    const k=normalizeTemplateKey(t.concept);
    return k==='ing' || k==='ing ingreso';
  });
  const chosen=new Set();
  const r=ingRules();
  for(const m of (r.mesesIngreso||[1,7]).map(Number)){
    // Buscar en TODAS las fechas disponibles de ING INGRESO del año y elegir
    // la más cercana al dia 1 del mes objetivo. Esto permite que julio use
    // 30/06 cuando esa sea la fecha libre mas cercana en la plantilla 2027.
    const preferred=all.filter(t=>normalizeTemplateKey(t.concept)==='ing ingreso')
      .map(t=>String(year)+String(t.date).slice(4));
    const fallback=all.filter(t=>normalizeTemplateKey(t.concept)==='ing')
      .map(t=>String(year)+String(t.date).slice(4));
    const candidates=preferred.length?preferred:fallback;
    const d=nearestTemplateDateForMonth(year,m,candidates);
    if(d) chosen.add(d);
  }
  return chosen;
}

function generarAnoDesdePlantilla(year){
  if(!TEMPLATE_2027) throw new Error('La plantilla 2027 no está cargada');
  const yearStr=String(year);
  const existing=DB.years[yearStr];
  const prevDays=existing?.days ? existing.days.slice() : [];
  const prevCard=existing?.cardEntries ? existing.cardEntries.slice() : [];
  const prevDaysMap=new Map(prevDays.map(d=>[d.date+'|'+String(d.concept||''),d]));
  const prevCardMap=new Map(prevCard.map(c=>[templateCardKey(c.month,c.category),c]));
  const ingDates=generateIngIncomeDates(year,TEMPLATE_2027.days);
  const todayIso=isoDate(new Date());

  // Primero resolvemos Tarjeta para poder construir las líneas "Tarjetas Mes" del Diario.
  // Correcciones definitivas acordadas para la estructura 2027:
  // - YouTube pasa de julio a agosto, porque MASTER lo sitúa en agosto.
  // - Esqui se incorpora en febrero como gasto de vacaciones.
  const adjustedCardTemplate = (TEMPLATE_2027.cardEntries||[])
    .filter(c=>!(normalizeTemplateKey(c.category)==='youtube' && Number(c.month)===7))
    .map(c=>({...c}));
  if(!adjustedCardTemplate.some(c=>normalizeTemplateKey(c.category)==='youtube' && Number(c.month)===8)) {
    adjustedCardTemplate.push({id:uid(),month:8,category:'YouTube',amount:0});
  }
  if(!adjustedCardTemplate.some(c=>normalizeTemplateKey(c.category)==='esquí' && Number(c.month)===2)) {
    adjustedCardTemplate.push({id:uid(),month:2,category:'Esquí',amount:0});
  }

  // Regla de cierre: una categoría de tarjeta cuyo mes natural ya ha terminado
  // no vuelve a calcularse desde MASTER. Se conserva exactamente como estaba.
  // En el año actual solo quedan abiertos el mes actual y los posteriores; en
  // años futuros todos los meses están abiertos.
  const isClosedCalendarMonth = (y,m) => {
    const lastDayIso = isoDate(new Date(Number(y), Number(m), 0));
    return lastDayIso < todayIso;
  };

  const cardAgg=new Map();
  for(const c of adjustedCardTemplate){
    const month=Number(c.month);
    const templateName=String(c.category||'');
    const matches=masterMatchesForTemplate(templateName,'tarjeta');
    const resolvedName=matches.length ? matches[0].name : templateName;
    const groupKey=month+'|'+normalizeTemplateKey(resolvedName);

    // Si este mes ya está cerrado y había un valor previo, ese valor histórico
    // manda: el MASTER no puede modificarlo.
    if(isClosedCalendarMonth(year,month)) {
      const previous = prevCard.filter(pc => Number(pc.month)===month && normalizeTemplateKey(pc.category)===normalizeTemplateKey(resolvedName));
      if(previous.length){
        const preserved = previous.reduce((s,pc)=>s + Number(pc.amount||0),0);
        if(preserved !== 0){
          if(!cardAgg.has(groupKey)) cardAgg.set(groupKey,{id:previous[0].id||uid(),month,category:resolvedName,amount:0,sourceTemplate2027:true,sourceCalculation:'historical',type:(previous[0].type||((matches.some(x=>x.tipo==='vacaciones'))?'vacaciones':'gasto')),manualType:!!previous[0].manualType});
          cardAgg.get(groupKey).amount += preserved;
          continue;
        }
      }
    }

    const previousOpen = prevCard.find(pc=>
      Number(pc.month)===month &&
      normalizeTemplateKey(pc.category)===normalizeTemplateKey(resolvedName) &&
      pc.manualEdit===true
    );
    if(previousOpen){
      if(!cardAgg.has(groupKey)) cardAgg.set(groupKey,{id:previousOpen.id||uid(),month,category:resolvedName,amount:Number(previousOpen.amount||0),sourceTemplate2027:true,sourceCalculation:'manual',manualEdit:true,type:(previousOpen.type||((matches.some(x=>x.tipo==='vacaciones'))?'vacaciones':'gasto')),manualType:!!previousOpen.manualType});
      continue;
    }

    const result=amountForTemplateCard(templateName,year,month);
    if(!result.include) continue;
    if(!cardAgg.has(groupKey)) cardAgg.set(groupKey,{id:uid(),month,category:resolvedName,amount:0,sourceTemplate2027:true,sourceCalculation:'master',type:(matches.some(x=>x.tipo==='vacaciones')?'vacaciones':'gasto')});
    cardAgg.get(groupKey).amount += result.amount;
  }
  const cardEntries=Array.from(cardAgg.values());

  const cardTotalByMonth={};
  cardEntries.forEach(c=>{ cardTotalByMonth[c.month]=(cardTotalByMonth[c.month]||0)+Number(c.amount||0); });

  const days=[];
  for(const t of TEMPLATE_2027.days){
    const date=String(year)+String(t.date).slice(4);
    const concept=String(t.concept||'');
    const key=date+'|'+concept;
    const prev=prevDaysMap.get(key);
    const isPast=date<todayIso;
    if(prev && isPast){
      days.push(prev);
      continue;
    }

    let result;
    if(/^tarjetas\s+/i.test(concept)){
      const m=parseDateISO(date).getMonth()+1;
      result={include:(cardTotalByMonth[m]||0)>0, amount:-(cardTotalByMonth[m]||0), source:'card-total'};
    }else{
      result=amountForTemplateDay(concept,date,year,ingDates);
    }
    if(!result.include) continue;
    days.push({id:prev?.id||uid(),date,concept,amount:result.amount,sourceTemplate2027:true,sourceCalculation:result.source});
  }

  const prevManualDays=prevDays.filter(d=>!/^tarjetas\s+/i.test(String(d.concept||'')) && !d.sourceTemplate2027 && !d.sourceMaster && !days.some(x=>x.id===d.id));
  const prevManualCard=prevCard.filter(c=>!c.sourceTemplate2027 && !c.sourceMaster && !cardEntries.some(x=>x.id===c.id));
  days.push(...prevManualDays);
  cardEntries.push(...prevManualCard);

  let start=existing?.start||0;
  const prevYear=DB.years[String(year-1)];
  if(prevYear){
    const sorted=getSortedDays(year-1);
    start=sorted.length?sorted[sorted.length-1].balance:(prevYear.start||0);
  }
  DB.years[yearStr]={start,days,cardEntries};
}

function sincronizarDiarioConFijos(){
  if(!TEMPLATE_2027 || !DB.masterLoaded) return;
  // 2027 queda protegido como versión definitiva. MASTER solo refresca años posteriores.
  const years=fijosYears().filter(y=>y>2027 && DB.years[String(y)]).sort((a,b)=>a-b);
  years.forEach(year=>generarAnoDesdePlantilla(year));
}

function regenerar2027UnaVez(){
  if(!TEMPLATE_2027){ toast('La estructura 2027 no está cargada'); return; }
  if(!DB.masterLoaded){ toast('Carga MASTER primero'); return; }
  if(DB.regenerated2027Once){ toast('2027 ya fue regenerado y queda protegido'); return; }
  if(!confirm('Se regenerará ÚNICAMENTE 2027 con la estructura definitiva de 2027, las reglas especiales y los importes actuales de MASTER. 2026 no se tocará. ¿Continuar?')) return;
  generarAnoDesdePlantilla(2027);
  ui.year='2027';
  DB.regenerated2027Once=true;
  DB.updatedAt=new Date().toISOString();
  saveDB();
  applyProjectionButtonState();
  renderAll();
  if(gistSync.token) syncGistNow();
  else setGistStatus('pending','☁ 2027 regenerado · cambios locales pendientes');
  toast('2027 regenerado y protegido.');
}

function generar2028UnaVez(){
  if(!TEMPLATE_2027){ toast('La estructura 2027 no está cargada'); return; }
  if(!DB.masterLoaded){ toast('Carga MASTER primero'); return; }
  const existing=DB.years['2028'];
  if(existing && ((existing.days&&existing.days.length)||(existing.cardEntries&&existing.cardEntries.length))){
    DB.futureGenerationLocked=true;
    saveDB({sync:false});
    applyProjectionButtonState();
    toast('2028 ya existe y no se vuelve a generar');
    return;
  }
  if(!confirm('2027 está protegido y no se modificará. Se generará únicamente 2028 usando la estructura de 2027 y los importes de MASTER. ¿Continuar?')) return;
  generarAnoDesdePlantilla(2028);
  ui.year='2028';
  DB.futureGenerationLocked=true;
  DB.updatedAt=new Date().toISOString();
  saveDB();
  applyProjectionButtonState();
  renderAll();
  if(gistSync.token) syncGistNow();
  else setGistStatus('pending','☁ 2028 generado · cambios locales pendientes');
  toast('2028 generado. 2027 queda protegido.');
}

function applyProjectionButtonState(){
  const b28=document.getElementById('btnGenerar2028');
  if(b28) b28.style.display = DB.futureGenerationLocked ? 'none' : '';
}

function openSpecialRulesModal(){
  const r=ingRules();
  openModal(`
    <h3>Reglas especiales · ING</h3>
    <div class="field-row"><label>Ingreso semestral (€)</label><input class="field" type="number" step="0.01" id="ingIngreso" value="${r.ingresoSemestral}"></div>
    <div class="field-row"><label>Gasto normal ING (€)</label><input class="field" type="number" step="0.01" id="ingGastoNormal" value="${r.gastoNormal}"></div>
    <div class="field-row"><label>Meses de ingreso (1 = enero, 7 = julio)</label><input class="field" type="text" id="ingMeses" value="${(r.mesesIngreso||[]).join('|')}"></div>
    <div class="field-row"><label>Último ingreso</label><input class="field" type="date" id="ingUltimoIngreso" value="${r.ultimoIngreso}"></div>
    <div class="field-row"><label>Fecha de cambio a gasto reducido</label><input class="field" type="date" id="ingCambioGasto" value="${r.cambioGasto}"></div>
    <div class="field-row"><label>Gasto reducido ING (€)</label><input class="field" type="number" step="0.01" id="ingGastoReducido" value="${r.gastoReducido}"></div>
    <div class="field-row"><label>Fin del gasto ING</label><input class="field" type="date" id="ingFinGasto" value="${r.finGasto}"></div>
    <div style="font-size:12px;color:var(--ink-soft);">En enero/julio se usa la fecha de ING de la plantilla más cercana al día 1 disponible. Después de la última fecha indicada no se generan más ING.</div>
    <div class="modal-actions"><button class="btn ghost" id="ingCancel">Cancelar</button><button class="btn primary" id="ingSave">Guardar reglas</button></div>
  `,()=>{
    document.getElementById('ingCancel').onclick=closeModal;
    document.getElementById('ingSave').onclick=()=>{
      const meses=String(document.getElementById('ingMeses').value||'').split('|').map(v=>Number(v.trim())).filter(v=>v>=1&&v<=12);
      DB.specialRules={ing:{
        ingresoSemestral:Number(document.getElementById('ingIngreso').value)||0,
        gastoNormal:Number(document.getElementById('ingGastoNormal').value)||0,
        mesesIngreso:meses,
        ultimoIngreso:document.getElementById('ingUltimoIngreso').value,
        cambioGasto:document.getElementById('ingCambioGasto').value,
        gastoReducido:Number(document.getElementById('ingGastoReducido').value)||0,
        finGasto:document.getElementById('ingFinGasto').value
      }};
      if(TEMPLATE_2027 && DB.masterLoaded) sincronizarDiarioConFijos();
      DB.updatedAt=new Date().toISOString(); saveDB(); closeModal(); renderAll(); toast('Reglas especiales actualizadas');
    };
  });
}

function parseGastosSheet(rows){
  return parseMasterRows(rows);
}

function masterFingerprint(items){
  return JSON.stringify((items||[]).map(item=>({
    id:item.id,name:item.name,tipo:item.tipo,groupId:item.groupId,masterGroup:item.masterGroup,masterTipo:item.masterTipo,
    frecuencia:item.frecuencia,meses:item.meses,medio:item.medio,activo:item.activo,orden:item.orden,
    values:item.values
  })).sort((a,b)=>String(a.id).localeCompare(String(b.id))));
}

async function loadMasterBuffer(buf, sourceLabel='MASTER', options={}){
  const wb = XLSX.read(buf, {type:'array', cellDates:true});
  const masterName = wb.SheetNames.find(name=>/^master$/i.test(name.trim()));
  if(!masterName) throw new Error('No se encontró la hoja MASTER');
  const ws = wb.Sheets[masterName];
  const rows = XLSX.utils.sheet_to_json(ws, {header:1, raw:true, defval:null});
  const items = parseMasterRows(rows);
  if(!items.length) throw new Error('La hoja MASTER no contiene partidas válidas');
  const current = (DB.fijos||[]).filter(f=>f.source==='master');
  const changed = masterFingerprint(items) !== masterFingerprint(current);
  if(changed){
    installMasterItems(items);
    DB.masterLoaded=true;
    if(options.syncStructure!==false) sincronizarDiarioConFijos();
    if(options.persist!==false){
      DB.updatedAt = new Date().toISOString();
      saveDB({sync: options.sync !== false});
    }
    if(options.render!==false) renderAll();
    setMasterStatus(`MASTER actualizado · ${items.length} partidas`, true);
  }else{
    DB.masterLoaded=true;
    setMasterStatus(`MASTER al día · ${items.length} partidas`, true);
  }
  setBootstrapStatus(bootstrapStateText(), true);
  return {count:items.length,changed};
}

// ============================================================
// IMPORTACIÓN 2026 / PLANTILLA 2027 SOLO PARA BOOTSTRAP INICIAL
// ============================================================
const CARD_2026_PAIRS = [[5,6],[8,9],[11,12]]; // F/G, I/J, L/M (0-indexed)

function merge2026CardEntries(rows){
  const monthStarts=[];
  rows.forEach((row,idx)=>{
    const v=row[5];
    if(typeof v==='string' && MESES.includes(v.trim())) monthStarts.push({row:idx,month:MESES.indexOf(v.trim())+1});
  });
  const agg=new Map();
  for(let i=0;i<monthStarts.length;i++){
    const start=monthStarts[i].row+1;
    const end=i+1<monthStarts.length?monthStarts[i+1].row:rows.length;
    const month=monthStarts[i].month;
    for(let r=start;r<end;r++){
      const row=rows[r]||[];
      for(const [nameCol,valCol] of CARD_2026_PAIRS){
        const rawName=row[nameCol], rawVal=row[valCol];
        if(rawName==null || String(rawName).trim()==='') continue;
        if(typeof rawVal!=='number' || !Number.isFinite(rawVal)) continue;
        const category=String(rawName).trim();
        const key=`${month}|${normalizeName(category)}`;
        const existing=agg.get(key);
        if(existing) existing.amount+=rawVal;
        else agg.set(key,{id:uid(),month,category,amount:rawVal});
      }
    }
  }
  return Array.from(agg.values());
}

function parse2026Sheet(rows){
  const days=[]; let start=0; let startFound=false;
  for(const row of rows){
    const d=row?.[0];
    if(!(d instanceof Date) || d.getFullYear()!==FIJOS_REF_YEAR) continue;
    const dateIso=isoDate(d);
    if(!startFound && typeof row?.[3]==='number'){ start=row[3]; startFound=true; }
    const concept=row?.[1]==null?'':String(row[1]).trim();
    const amount=typeof row?.[2]==='number' && Number.isFinite(row[2])?row[2]:0;
    days.push({id:uid(),date:dateIso,concept,amount,source:'2026-bootstrap'});
  }
  if(days.length!==365) throw new Error(`Se esperaban 365 días de 2026 y se han leído ${days.length}`);
  return {start,days,cardEntries:merge2026CardEntries(rows),source:'2026-bootstrap'};
}

async function read2026WorkbookBuffer(buf){
  const wb=XLSX.read(buf,{type:'array',cellDates:true});
  const sheetName=wb.SheetNames.find(name=>/^2026$/i.test(name.trim()))||wb.SheetNames[0];
  if(!sheetName) throw new Error('No se encontró la hoja de 2026');
  const rows=XLSX.utils.sheet_to_json(wb.Sheets[sheetName],{header:1,raw:true,defval:null});
  return parse2026Sheet(rows);
}

function parse2027TemplateRows(rows){
  const days=[];
  for(const row of rows){
    const d=row?.[0];
    if(!(d instanceof Date) || d.getFullYear()!==2027) continue;
    days.push({date:isoDate(d),concept:row?.[1]==null?'':String(row[1]).trim()});
  }
  if(days.length!==365) throw new Error(`Se esperaban 365 días de 2027 y se han leído ${days.length}`);

  const agg=new Map();
  for(const row of rows){
    const d=row?.[0];
    if(!(d instanceof Date) || d.getFullYear()!==2027) continue;
    const month=d.getMonth()+1;
    for(const col of [5,7,9]){ // F, H, J
      const raw=row?.[col];
      if(raw==null || raw instanceof Date) continue;
      const category=String(raw).trim();
      if(!category || MESES.includes(category)) continue;
      const key=`${month}|${normalizeName(category)}`;
      if(!agg.has(key)) agg.set(key,{id:uid(),month,category,amount:0});
    }
  }
  return {year:2027,days,cardEntries:Array.from(agg.values()),source:'2027-bootstrap'};
}

async function read2027WorkbookBuffer(buf){
  const wb=XLSX.read(buf,{type:'array',cellDates:true});
  const sheetName=wb.SheetNames.find(name=>/^2027$/i.test(name.trim()))||wb.SheetNames[0];
  if(!sheetName) throw new Error('No se encontró la hoja de 2027');
  const rows=XLSX.utils.sheet_to_json(wb.Sheets[sheetName],{header:1,raw:true,defval:null});
  return parse2027TemplateRows(rows);
}

async function fetchWorkbookFromCandidates(urls){
  let lastErr=null;
  for(const baseUrl of urls){
    try{
      const res=await fetch(baseUrl+MASTER_REFRESH_PARAM(),{cache:'no-store'});
      if(!res.ok){lastErr=new Error(`HTTP ${res.status} · ${baseUrl}`);continue;}
      return await res.arrayBuffer();
    }catch(err){lastErr=err;}
  }
  throw lastErr||new Error('No se pudo localizar el archivo');
}

async function cargarMasterAutomatico(){
  setMasterStatus('Cargando MASTER…');
  try{
    const buf=await fetchWorkbookFromCandidates(MASTER_URLS);
    await loadMasterBuffer(buf,'GitHub',{sync:true,persist:true,render:true});
    return true;
  }catch(err){
    console.warn('No se pudo cargar MASTER automáticamente:',err);
    setMasterStatus(`MASTER no disponible · ${err.message||'revisa la carpeta excel'}`,false);
    return false;
  }
}

// ============================================================
// INICIALIZACION MANUAL DE 2026 / ESTRUCTURA 2027
// Los dos Excel son fuentes de bootstrap: el usuario los selecciona
// una sola vez y la estructura queda guardada en local/Gist.
// MASTER, en cambio, sigue siendo una fuente viva y se refresca al arrancar.
// ============================================================
function manualBootstrapState(){
  if(!DB.bootstrap) DB.bootstrap={version:0};
  return DB.bootstrap;
}

function markManualBootstrap(kind, sourceName){
  const st=manualBootstrapState();
  const now=new Date().toISOString();
  st.version=Math.max(Number(st.version)||0, BOOTSTRAP_VERSION);
  st[kind]={importedAt:now,source:sourceName};
  st.completedAt=now;
  DB.bootstrap=st;
}

function hasManual2026(){
  return !!(DB.years && DB.years[String(FIJOS_REF_YEAR)] && DB.years[String(FIJOS_REF_YEAR)].days?.length===365);
}
function hasManual2027(){
  return !!(TEMPLATE_2027 && TEMPLATE_2027.days?.length===365);
}

function bootstrapStateText(){
  const hasMaster = !!DB.masterLoaded && Array.isArray(DB.fijos) && DB.fijos.some(f=>f.source==='master');
  return `Base: 2026 ${hasManual2026()?'✓':'—'} · estructura 2027 ${hasManual2027()?'✓':'—'} · MASTER ${hasMaster?'✓':'—'}`;
}

async function importar2026Manual(file){
  if(!file) return;
  try{
    setBootstrapStatus('Leyendo 2026.xlsx…');
    const parsed=await read2026WorkbookBuffer(await file.arrayBuffer());
    DB.years[String(FIJOS_REF_YEAR)]=parsed;
    markManualBootstrap('year2026', file.name||'2026.xlsx');
    DB.updatedAt=new Date().toISOString();
    ui.year=String(FIJOS_REF_YEAR);
    saveDB();
    renderAll();
    setBootstrapStatus(bootstrapStateText(),true);
    if(gistSync.token) await syncGistNow();
    else setGistStatus('pending','☁ 2026 importado · cambios locales pendientes');
    toast('2026 importado y guardado');
  }catch(err){
    console.error('No se pudo importar 2026:',err);
    setBootstrapStatus(`Error 2026 · ${err.message||'archivo no válido'}`,false);
    toast('No se pudo importar 2026');
  }
}

async function importar2027Manual(file){
  if(!file) return;
  try{
    setBootstrapStatus('Leyendo 2027.xlsx…');
    const parsed=await read2027WorkbookBuffer(await file.arrayBuffer());
    DB.template2027=parsed;
    TEMPLATE_2027=parsed;
    markManualBootstrap('template2027', file.name||'2027.xlsx');
    generarAnoDesdePlantilla(2027);
    DB.updatedAt=new Date().toISOString();
    ui.year='2027';
    saveDB();
    renderAll();
    setBootstrapStatus(bootstrapStateText(),true);
    if(gistSync.token) await syncGistNow();
    else setGistStatus('pending','☁ 2027 importado · cambios locales pendientes');
    toast('Estructura 2027 importada y guardada');
  }catch(err){
    console.error('No se pudo importar 2027:',err);
    setBootstrapStatus(`Error 2027 · ${err.message||'archivo no válido'}`,false);
    toast('No se pudo importar 2027');
  }
}

async function initializeData(){
  // Regla única: el Gist es la fuente de verdad. Al entrar, SIEMPRE se llama al Gist
  // (nunca se arranca "como si nada" con la copia local). Si la lectura del Gist
  // falla, el dashboard NO finge tener datos al día: avisa claramente y bloquea el
  // autoguardado hasta que una lectura fresca del Gist tenga éxito, para que nunca
  // se pueda sobrescribir el Gist con un estado que no sabemos si es el último.
  try{
    const remote=await Promise.race([
      fetchGistRemote(),
      new Promise((_,reject)=>setTimeout(()=>reject(new Error('Timeout de lectura del Gist')),8000))
    ]);
    if(remote?.exists){
      const remoteUpdatedAt=remote.payload.updatedAt||remote.gist?.updated_at||new Date().toISOString();
      gistSync.suppress=true;
      applyGistData(remote.payload.data);
      DB.updatedAt=remoteUpdatedAt;
      DB.syncMeta={lastSyncedAt:remoteUpdatedAt, forceLocalImport:false};
      saveDB({sync:false});
      gistSync.suppress=false;
      gistSync.remoteUpdatedAt=remoteUpdatedAt;
      gistSync.loadedFromGist=true;
      if(remote.possiblyCached){
        setGistStatus('pending',`☁ Gist cargado (copia pública, puede ir unos minutos por detrás) · ${formatSyncDate(remoteUpdatedAt)}`);
      }else{
        setGistStatus('ok',`☁ Gist central cargado · ${formatSyncDate(remoteUpdatedAt)}`);
      }
      return true;
    }
    // El Gist responde pero todavía no existe el archivo: es un estado inicial
    // legítimo y confirmado, no un fallo de red. Arrancamos en blanco.
    gistSync.loadedFromGist=true;
    setBootstrapStatus('2026/2027 en Gist · MASTER se carga automáticamente');
    setGistStatus('ok','☁ Gist listo · todavía no existen datos guardados');
    return true;
  }catch(err){
    console.warn('Gist no disponible durante el arranque:',err);
  }finally{
    gistSync.suppress=false;
  }

  // El Gist no ha respondido: NO se usa la copia local como si fuera válida.
  // Se bloquea el guardado hasta reintentar con éxito (botón ☁ Gist › Traer del Gist).
  gistSync.loadedFromGist=false;
  setBootstrapStatus('No se pudo leer el Gist · comprueba tu conexión', false);
  setGistStatus('error','⚠ No se pudo leer el Gist · pulsa ☁ Gist › "Traer del Gist" para reintentar. Los cambios no se guardan hasta entonces.');
  return false;
}

function exportDashboardJson(){
  const portable = {
    schemaVersion: 2,
    dashboard: 'diario-gastos',
    exportedAt: new Date().toISOString(),
    data: JSON.parse(JSON.stringify(DB, (key,value)=> key==='syncMeta' ? undefined : value)),
    calculatedSnapshots: Object.fromEntries(Object.keys(DB.years||{}).map(y=>[y,{yearTotals:yearTotals(y),monthlyAggregates:monthlyAggregates(y)}]))
  };
  const blob = new Blob([JSON.stringify(portable,null,2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `diario-gastos-backup-${isoDate(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function importDashboardJson(file){
  if(!file) return;
  try{
    const text=await file.text();
    const parsed=JSON.parse(text);
    const importedData=(parsed && parsed.data && typeof parsed.data==='object') ? parsed.data : parsed;
    if(!importedData || typeof importedData!=='object' || !importedData.years) throw new Error('El JSON no contiene datos de Diario válidos');
    gistSync.suppress=true;
    applyGistData(importedData);
    DB.updatedAt=new Date().toISOString();
    DB.syncMeta={lastSyncedAt:null, forceLocalImport:true};
    saveDB({sync:false});
    gistSync.suppress=false;
    renderAll();
    // Importar es una acción explícita: igual que meter el token, lo que quede en
    // pantalla se sube al Gist tal cual si hay token. Si no hay token, se avisa
    // claramente de que no se ha guardado nada todavía.
    gistSync.loadedFromGist=true;
    if(gistSync.token){
      const ok = await syncGistNow(true);
      toast(ok ? 'JSON importado y guardado en el Gist' : 'JSON importado, pero falló el guardado en el Gist');
    }else{
      setGistStatus('pending','☁ JSON importado · sin token, no se ha guardado en el Gist');
      toast('JSON importado (sin token, no se ha guardado)');
    }
  }catch(err){
    console.error('No se pudo importar JSON:',err);
    toast('No se pudo importar JSON');
  }finally{
    const el=document.getElementById('importJsonFile'); if(el) el.value='';
  }
}

document.getElementById('btnExport').addEventListener('click', exportDashboardJson);
document.getElementById('importJsonFile').addEventListener('change', async e=>{ await importDashboardJson(e.target.files[0]); });

// ============================================================
// EVENTOS UI
// ============================================================
document.querySelectorAll('#dayTabs .tab-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('#dayTabs .tab-btn').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v=>{ v.classList.remove('active'); v.style.display='none'; });
    btn.classList.add('active');
    const view=document.getElementById('view-'+btn.dataset.view);
    if(view){ view.classList.add('active'); view.style.display='block'; }
  });
});
document.getElementById('yearSelect').addEventListener('change', e=>{
  ui.year = e.target.value;
  ui.monthFilterDiario = 'todos';
  ui.calendarMonth = {year:Number(ui.year), month:Number(ui.year)===new Date().getFullYear()?new Date().getMonth()+1:1};
  renderAll();
});
document.getElementById('importMasterFile').addEventListener('change', async e=>{
  const file=e.target.files[0];
  if(!file) return;
  try{
    const buf=await file.arrayBuffer();
    await loadMasterBuffer(buf,'archivo seleccionado',{sync:true,persist:true,render:true});
    toast('MASTER importado correctamente');
  }catch(err){
    console.error(err);
    setMasterStatus(`MASTER no disponible · ${err.message||'archivo no válido'}`,false);
    toast('No se pudo importar MASTER');
  }finally{ e.target.value=''; }
});

document.getElementById('btnSpecialRulesTop').addEventListener('click', openSpecialRulesModal);

document.getElementById('btnGenerar2028').addEventListener('click', generar2028UnaVez);
document.getElementById('btnSyncMaster').addEventListener('click', cargarMasterAutomatico);
document.getElementById('btnGist').addEventListener('click', openGistPanel);
document.getElementById('btnAddMov').addEventListener('click', modalAddMovimiento);
document.getElementById('btnAddCat').addEventListener('click', modalAddCategoria);
document.getElementById('btnAddFijo').addEventListener('click', modalAddFijo);
document.getElementById('btnAddGroup').addEventListener('click', modalAddGroup);
document.getElementById('btnIPC').addEventListener('click', modalIPC);
const btnSpecialRules=document.getElementById('btnSpecialRules'); if(btnSpecialRules) btnSpecialRules.addEventListener('click', openSpecialRulesModal);
document.getElementById('btnCalendar').addEventListener('click', ()=>{
  const pop=document.getElementById('calendarPopover');
  const active=pop.classList.toggle('active');
  document.getElementById('btnCalendar').setAttribute('aria-expanded', String(active));
  if(active) renderCalendarPopover();
});
document.getElementById('calPrev').addEventListener('click', ()=>{
  const y=Number(ui.year)||new Date().getFullYear();
  let m=calendarBaseMonth()-1;
  if(m<1) m=12;
  ui.calendarMonth={year:y,month:m};
  renderCalendarPopover();
});
document.getElementById('calNext').addEventListener('click', ()=>{
  const y=Number(ui.year)||new Date().getFullYear();
  let m=calendarBaseMonth()+1;
  if(m>12) m=1;
  ui.calendarMonth={year:y,month:m};
  renderCalendarPopover();
});
document.getElementById('calendarDays').addEventListener('click', e=>{
  const b=e.target.closest('button[data-cal-date]');
  if(!b) return;
  const y=Number(b.dataset.calYear), m=Number(b.dataset.calMonth);
  if(y!==Number(ui.year)){ ui.year=String(y); document.getElementById('yearSelect').value=String(y); }
  ui.monthFilterDiario=String(m);
  ui.calendarMonth={year:y,month:m};
  document.getElementById('calendarPopover').classList.remove('active');
  document.getElementById('btnCalendar').setAttribute('aria-expanded','false');
  renderAll();
});
document.getElementById('calAll').addEventListener('click', ()=>{
  ui.monthFilterDiario='todos';
  ui.calendarMonth={year:Number(ui.year),month:calendarBaseMonth()};
  document.getElementById('calendarPopover').classList.remove('active');
  document.getElementById('btnCalendar').setAttribute('aria-expanded','false');
  renderAll();
});
document.addEventListener('pointerdown', e=>{
  const pop=document.getElementById('calendarPopover');
  const btn=document.getElementById('btnCalendar');
  if(pop && pop.classList.contains('active') && !pop.contains(e.target) && !btn.contains(e.target)){
    pop.classList.remove('active');
    btn.setAttribute('aria-expanded','false');
  }
  const active=document.activeElement;
  if(active && active.matches('input, textarea, select') && !active.closest('.modal') && !active.contains(e.target)){
    active.blur();
  }
});
document.getElementById('tarjMonthSelect').addEventListener('change', e=>{
  ui.tarjMonth = Number(e.target.value); renderTarjeta();
});
document.getElementById('btnCerrarMes').addEventListener('click', ()=>{
  if(!ui.year){ toast('Selecciona un año'); return; }
  const m = ui.monthFilterDiario==='todos' ? (new Date().getMonth()+1) : Number(ui.monthFilterDiario);
  const yd = ensureYear(ui.year);
  const catEntries = yd.cardEntries.filter(c=>Number(c.month)===m);
  if(!catEntries.length){ toast('No hay gastos de tarjeta ese mes'); return; }
  const total = catEntries.reduce((s,c)=>s+Number(c.amount||0),0);
  syncTarjetaMonthToDiario(ui.year, m);
  saveDB(); renderAll();
  toast(`Mes actualizado: −${fmt(total)} € en tarjeta`);
});


// ============================================================
// GIST: sincronización central
// ============================================================
function gistHeaders(token){
  const h = {
    'Accept':'application/vnd.github+json',
    'X-GitHub-Api-Version': GIST_API_VERSION
  };
  if(token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

function gistFetch(url, options={}){
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), GIST_TIMEOUT_MS);
  // No-store siempre: ni el navegador ni Safari privado deben poder servir
  // una respuesta cacheada del Gist. Queremos SIEMPRE ir a red.
  return fetch(url, {cache:'no-store', ...options, signal:controller.signal}).finally(()=>clearTimeout(timer));
}

function setGistStatus(kind, text){
  const el = document.getElementById('gistStatus');
  if(!el) return;
  el.textContent = text;
  el.dataset.kind = kind || '';
  gistSync.lastStatus = {kind, text};
}

function formatSyncDate(iso){
  if(!iso) return '';
  const d = new Date(iso);
  if(isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('es-ES', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(d);
}

function localToken(){
  try{
    const remembered = localStorage.getItem(GIST_REMEMBER_KEY)==='1';
    if(remembered){
      const t = localStorage.getItem(GIST_TOKEN_LOCAL_KEY);
      if(t) return {token:t, remember:true};
    }
    const s = sessionStorage.getItem(GIST_TOKEN_SESSION_KEY);
    if(s) return {token:s, remember:false};
  }catch(e){ console.warn('No se pudo leer el token local:', e); }
  return {token:null, remember:false};
}

function setGistToken(token, remember){
  gistSync.token = String(token||'').trim() || null;
  gistSync.rememberToken = !!remember;
  try{
    if(gistSync.token){
      sessionStorage.setItem(GIST_TOKEN_SESSION_KEY, gistSync.token);
      if(remember){
        localStorage.setItem(GIST_REMEMBER_KEY, '1');
        localStorage.setItem(GIST_TOKEN_LOCAL_KEY, gistSync.token);
      }else{
        localStorage.removeItem(GIST_REMEMBER_KEY);
        localStorage.removeItem(GIST_TOKEN_LOCAL_KEY);
      }
    }else{
      sessionStorage.removeItem(GIST_TOKEN_SESSION_KEY);
      localStorage.removeItem(GIST_REMEMBER_KEY);
      localStorage.removeItem(GIST_TOKEN_LOCAL_KEY);
    }
  }catch(e){ console.warn('No se pudo guardar la preferencia del token:', e); }
}

function clearRememberedGistToken(){
  try{
    localStorage.removeItem(GIST_REMEMBER_KEY);
    localStorage.removeItem(GIST_TOKEN_LOCAL_KEY);
    sessionStorage.removeItem(GIST_TOKEN_SESSION_KEY);
  }catch(e){}
  gistSync.token = null;
  gistSync.rememberToken = false;
}

function gistPayload(){
  const snapshots = {};
  Object.keys(DB.years||{}).forEach(y=>{
    snapshots[y] = {
      yearTotals: yearTotals(y),
      monthlyAggregates: monthlyAggregates(y)
    };
  });
  const data = JSON.parse(JSON.stringify(DB));
  delete data.syncMeta;
  return {
    schemaVersion: 2,
    dashboard: 'diario-gastos',
    updatedAt: DB.updatedAt || new Date().toISOString(),
    data,
    calculatedSnapshots: snapshots,
    calculatedAt: new Date().toISOString(),
    engineVersion: 'gist-sync-1.0'
  };
}

function isValidGistPayload(payload){
  return !!payload && typeof payload==='object' && (
    (payload.data && typeof payload.data==='object') ||
    (payload.years && typeof payload.years==='object')
  );
}

function normalizeGistPayload(payload){
  if(payload && payload.data && typeof payload.data==='object'){
    return {
      data: payload.data,
      updatedAt: payload.updatedAt || payload.data.updatedAt || null,
      calculatedAt: payload.calculatedAt || null,
      engineVersion: payload.engineVersion || null
    };
  }
  return {data: payload, updatedAt: payload?.updatedAt || null, calculatedAt:null, engineVersion:null};
}

async function fetchGistRemote(){
  let apiError = null;
  try{
    // Usamos el token también para LEER (no solo para escribir) cuando existe:
    // así usamos el límite de peticiones autenticado de GitHub en vez del límite
    // anónimo (60/hora por IP), que es fácil de agotar entrando desde varios
    // dispositivos y probando varias veces.
    const res = await gistFetch(GIST_API_URL, {headers:gistHeaders(gistSync.token)});
    if(res.ok){
      const gist = await res.json();
      const file = gist.files && gist.files[GIST_FILE];
      if(file){
        let text = file.content;
        if(file.truncated && file.raw_url){
          const rawRes = await gistFetch(file.raw_url, {headers:gistHeaders(gistSync.token)});
          if(!rawRes.ok) throw new Error(`Gist raw HTTP ${rawRes.status}`);
          text = await rawRes.text();
        }
        const payload = JSON.parse(text);
        if(!isValidGistPayload(payload)) throw new Error('El archivo del Gist no tiene un formato válido');
        return {exists:true, payload:normalizeGistPayload(payload), gist, response:res, source:'api'};
      }
      return {exists:false, payload:null, response:res, gist, source:'api'};
    }
    if(res.status===404) return {exists:false, payload:null, response:res, source:'api'};
    apiError = new Error(`Gist HTTP ${res.status}`);
  }catch(err){
    apiError = err;
  }

  // Fallback de lectura pública: evita depender de api.github.com en navegadores
  // con restricciones especiales (Safari privado, bloqueadores, rate limits, etc.).
  // OJO: gist.githubusercontent.com/.../raw/... va detrás de una CDN (Fastly) que
  // cachea la respuesta durante varios minutos. Sin un parámetro que rompa esa
  // caché, este fallback puede devolver una copia vieja del Gist aunque acabe de
  // guardarse una nueva — por eso se añade un timestamp y se marca la lectura
  // como "posible copia en caché" en vez de tratarla como si fuera igual de fiable
  // que la lectura por la API.
  try{
    const rawRes = await gistFetch(`${GIST_RAW_URL}?_=${Date.now()}`, {headers:{'Accept':'text/plain'}});
    if(!rawRes.ok) throw new Error(`Gist raw fallback HTTP ${rawRes.status}`);
    const payload = JSON.parse(await rawRes.text());
    if(!isValidGistPayload(payload)) throw new Error('El archivo raw del Gist no tiene un formato válido');
    return {exists:true, payload:normalizeGistPayload(payload), gist:null, response:rawRes, source:'raw', possiblyCached:true};
  }catch(rawErr){
    const detail = apiError?.message ? `${apiError.message}; ${rawErr.message}` : rawErr.message;
    throw new Error(`No se pudo leer el Gist remoto (${detail})`);
  }
}

function applyGistData(data){
  const clean = JSON.parse(JSON.stringify(data||{}));
  if(!clean.ipc) clean.ipc = {gastos:2, ingresos:0.5};
  if(!clean.fijos) clean.fijos = [];
  if(!clean.fijosGroups) clean.fijosGroups = [];
  if(!clean.years) clean.years = {};
  if(!('bootstrap' in clean)) clean.bootstrap={version:0};
  if(!('template2027' in clean)) clean.template2027=null;
  if(!('masterLoaded' in clean)) clean.masterLoaded=false;
  delete clean.token;
  delete clean.syncMeta;
  DB = clean;
  TEMPLATE_2027 = DB.template2027 || null;
}

function scheduleGistSync(){
  if(!gistSync.ready) return;
  // Nunca autoguardamos si esta sesión no ha confirmado leer el Gist primero:
  // así un fallo de red al arrancar no puede acabar sobrescribiendo el Gist
  // con un estado desfasado de este dispositivo.
  if(!gistSync.loadedFromGist){
    setGistStatus('error','⚠ Sin lectura reciente del Gist · los cambios NO se guardan · pulsa ☁ Gist › "Traer del Gist"');
    return;
  }
  if(!gistSync.token){
    setGistStatus('pending', '☁ Cambios locales pendientes · añade token para sincronizar');
    return;
  }
  clearTimeout(gistSync.timer);
  setGistStatus('syncing', '☁ Gist · sincronizando…');
  gistSync.timer = setTimeout(()=>syncGistNow(), 700);
}

async function syncGistNow(force=false){
  if(!force && !gistSync.loadedFromGist) return false;
  if(!gistSync.token || gistSync.syncing) return false;
  gistSync.syncing = true;
  try{
    setGistStatus('syncing', '☁ Gist · sincronizando…');
    const payload = gistPayload();
    const body = JSON.stringify({
      files: {[GIST_FILE]: {content: JSON.stringify(payload, null, 2)}}
    });
    const res = await gistFetch(GIST_API_URL, {
      method:'PATCH',
      headers:{...gistHeaders(gistSync.token), 'Content-Type':'application/json'},
      body
    });
    if(res.status===401 || res.status===403){
      throw new Error('Token sin permiso para escribir el Gist');
    }
    if(!res.ok) throw new Error(`Gist HTTP ${res.status}`);
    gistSync.remoteUpdatedAt = payload.updatedAt;
    DB.syncMeta = {lastSyncedAt:payload.updatedAt, forceLocalImport:false};
    localStorage.setItem(STORAGE_KEY, JSON.stringify(DB));
    setGistStatus('ok', `☁ Última actualización del Gist · ${formatSyncDate(payload.updatedAt)}`);
    return true;
  }catch(err){
    console.warn('No se pudo sincronizar Gist:', err);
    setGistStatus('error', '⚠ Gist · error de sincronización · cambios guardados localmente');
    return false;
  }finally{
    gistSync.syncing = false;
  }
}

async function replaceFromGist(){
  setGistStatus('loading', '☁ Gist · trayendo datos…');
  try{
    const remote = await fetchGistRemote();
    if(!remote.exists) throw new Error('No existe aún el archivo del dashboard en el Gist');
    gistSync.suppress = true;
    applyGistData(remote.payload.data);
    DB.updatedAt = remote.payload.updatedAt || remote.gist?.updated_at || new Date().toISOString();
    DB.syncMeta = {lastSyncedAt:DB.updatedAt, forceLocalImport:false};
    saveDB({sync:false});
    renderAll();
    gistSync.remoteUpdatedAt = DB.updatedAt;
    gistSync.loadedFromGist = true;
    if(remote.possiblyCached){
      setGistStatus('pending', `☁ Traído (copia pública, puede ir unos minutos por detrás) · ${formatSyncDate(DB.updatedAt)}`);
    }else{
      setGistStatus('ok', `☁ Última actualización del Gist · ${formatSyncDate(DB.updatedAt)}`);
    }
    toast('Datos traídos del Gist');
    return true;
  }catch(err){
    console.warn(err);
    setGistStatus('error', '⚠ No se pudo traer el Gist');
    toast('No se pudo traer el Gist');
    return false;
  }finally{
    gistSync.suppress = false;
  }
}

async function prepareTokenAndSync(token, remember){
  // Guardar simple: lo que hay ahora mismo en pantalla en este dispositivo se sube
  // al Gist, tal cual. Es una acción explícita del usuario (mete el token y pulsa
  // guardar), así que se fuerza el push aunque la lectura inicial del Gist hubiera
  // fallado — no se vuelve a descargar ni se resuelve silenciosamente contra otra versión.
  setGistToken(token, remember);
  if(!gistSync.token){
    setGistStatus('pending','☁ Sin token · solo lectura del Gist');
    return false;
  }
  const ok = await syncGistNow(true);
  if(ok) gistSync.loadedFromGist = true;
  return ok;
}

function openGistPanel(){
  const saved = localToken();
  openModal(`
    <h3>☁ Gist</h3>
    <div class="field-row"><label>Gist ID</label><input class="field" type="text" value="${GIST_ID}" readonly></div>
    <div class="field-row"><label>Archivo</label><input class="field" type="text" value="${GIST_FILE}" readonly></div>
    <div class="field-row"><label>Token de GitHub</label><input class="field" type="password" id="gistTokenInput" name="gistToken" autocomplete="current-password" spellcheck="false" value="${escapeHtml(saved.token||'')}"></div>
    <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--ink-soft);margin:-4px 0 12px;">
      <input type="checkbox" id="gistRemember" ${saved.remember?'checked':''}>
      Recordar token en este dispositivo
    </label>
    <div style="font-size:11.5px;color:var(--ink-soft);line-height:1.45;margin-bottom:12px;">
      El token solo se usa para escribir. No se guarda en el Gist ni se incluye en el JSON. El gestor de contraseñas del navegador puede ofrecer guardarlo.
    </div>
    <div class="modal-actions">
      <button class="btn ghost" id="gistClear">Borrar token</button>
      <button class="btn ghost" id="gistFetch">Traer del Gist</button>
      <button class="btn" id="gistSaveNow">Guardar ahora</button>
      <button class="btn primary" id="gistSaveClose">Guardar y cerrar</button>
    </div>
  `, ()=>{
    document.getElementById('gistClear').onclick = ()=>{ clearRememberedGistToken(); document.getElementById('gistTokenInput').value=''; document.getElementById('gistRemember').checked=false; setGistStatus('pending', '☁ Sin token · solo lectura del Gist'); };
    document.getElementById('gistFetch').onclick = async ()=>{ await replaceFromGist(); };
    document.getElementById('gistSaveNow').onclick = async ()=>{
      const token = document.getElementById('gistTokenInput').value.trim();
      const remember = document.getElementById('gistRemember').checked;
      await prepareTokenAndSync(token, remember);
    };
    document.getElementById('gistSaveClose').onclick = async ()=>{
      const token = document.getElementById('gistTokenInput').value.trim();
      const remember = document.getElementById('gistRemember').checked;
      await prepareTokenAndSync(token, remember);
      closeModal();
    };
  });
}

function initGistSync(){
  const saved = localToken();
  gistSync.token = saved.token;
  gistSync.rememberToken = saved.remember;
  gistSync.ready = true;
}

function setMasterStatus(msg, ok=null){
  const el=document.getElementById('masterStatus');
  if(!el) return;
  el.textContent=msg;
  el.style.color = ok===false ? 'var(--neg)' : (ok===true ? 'var(--pos)' : 'var(--ink-soft)');
}

// ============================================================
// RENDER ALL
// ============================================================
function renderAll(){
  // Reconciliar saldos iniciales de todos los años futuros con el cierre del año anterior.
  // Esto corrige estados antiguos de localStorage/Gist sin tocar los datos de movimientos.
  const startsChanged=reconcileFutureYearStarts();
  // Reconciliar siempre los totales de Tarjeta con Diario en años/meses abiertos.
  // Esto también arregla estados antiguos guardados en localStorage/Gist.
  Object.keys(DB.years||{}).forEach(y=>{ syncAllOpenTarjetasToDiario(Number(y)); });
  if(startsChanged) saveDB();
  populateYearSelect();
  populateMonthFilter();
  populateTarjMonthSelect();
  renderTicker();
  renderResumen();
  renderDiario();
  renderTarjeta();
  renderFijos();
}

async function initDashboard(){
  initGistSync();
  setGistStatus('loading','☁ Gist · cargando copia central…');
  // No renderizamos la base local/default antes de comprobar el Gist.
  // Así, un dispositivo sin localStorage (p.ej. navegación privada) no muestra
  // ceros/estado vacío mientras el remoto aún está disponible.
  await initializeData();
  Object.keys(DB.years||{}).forEach(y=>syncAllOpenTarjetasToDiario(Number(y)));
  saveDB({sync:false});
  // MASTER sí se refresca en cada arranque para detectar nuevos conceptos, renombres e importes.
  await cargarMasterAutomatico();
  setBootstrapStatus(bootstrapStateText(), true);
  renderAll();
  applyProjectionButtonState();
}

initDashboard();
