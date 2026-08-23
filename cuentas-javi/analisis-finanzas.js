/* Analisis Finanzas V1 - modulo independiente para Diario de Gastos */
(function(){
  const host=()=>document.getElementById('analysisHost');
  const eur=n=>`${fmt(Number(n)||0)} €`;
  const signed=n=>`${fmtSigned(Number(n)||0)} €`;
  const years=()=>Object.keys(DB.years||{}).map(Number).sort((a,b)=>a-b);
  const panel=(title,sub,body)=>`<div class="panel"><div class="panel-head"><h2>${title}</h2><span class="sub">${sub||''}</span></div>${body}</div>`;
  const table=(heads,rows)=>`<div class="analysis-table-wrap"><table class="analysis-table"><thead><tr>${heads.map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  function monthRows(y){return monthlyAggregates(y)}
  function renderGlobal(){
    const ys=years(); let acc=0;
    const rows=ys.map(y=>{const t=yearTotals(y);acc+=t.ahorro;const ahorroCls=t.ahorro>=0?'analysis-net-positive':'analysis-net-negative';const saldoCls=t.saldoFinal>=0?'amount-pos':'amount-neg';return `<tr><td><b>${y}</b></td><td class="num-cell">${eur(t.start)}</td><td class="num-cell analysis-income">${eur(t.ingresos)}</td><td class="num-cell analysis-expense">${eur(Math.abs(t.gastos))}</td><td class="num-cell"><span class="analysis-net-badge ${ahorroCls}">${signed(t.ahorro)}</span></td><td class="num-cell ${saldoCls}"><b>${eur(t.saldoFinal)}</b></td></tr>`});
    host().innerHTML=panel('Resumen Global','Todos los años disponibles',table(['Año','Saldo inicial','Ingresos','Gastos','Ahorro neto','Saldo final'],rows));
  }
  function renderAnnual(){
    const y=Number(ui.year)||years().slice(-1)[0];
    const t=yearTotals(y), ms=monthRows(y), sorted=getSortedDays(y).filter(e=>String(e.concept||'').trim());
    const diff=t.ahorro;
    const worst=ms.reduce((a,b)=>(b.ingresos+b.gastosOtros<a.ingresos+a.gastosOtros?b:a),ms[0]);
    const worstNet=worst.ingresos+worst.gastosOtros;
    const lowestSaldo=ms.reduce((a,b)=>Number(b.saldoFin)<Number(a.saldoFin)?b:a,ms[0]);
    const lowestSaldoCls=Number(lowestSaldo.saldoFin)>=0?'amount-pos':'amount-neg';
    const negativeEntries=sorted.filter(e=>Number(e.balance)<0);
    const firstNegative=negativeEntries.length?negativeEntries[0]:null;
    const worstNegative=negativeEntries.length?negativeEntries.reduce((a,b)=>Number(b.balance)<Number(a.balance)?b:a,negativeEntries[0]):null;
    const shortDate=e=>{if(!e)return '—';const d=parseDateISO(e.date);return `${d.getDate()} ${MESES_ABR[d.getMonth()].toLowerCase()}`;};
    const negativeLabel=e=>e?`${shortDate(e)} (${eur(e.balance)})`:'—';
    const saldoCls=t.saldoFinal>=0?'amount-pos':'amount-neg';
    const diffCls=diff>=0?'amount-pos':'amount-neg';
    const summary=`<div class="analysis-annual-summary">
      <span>💰 Ingresos: <strong class="analysis-income analysis-summary-plain">${eur(t.ingresos)}</strong></span>
      <span>💸 Gastos: <strong class="analysis-expense analysis-summary-plain">${eur(Math.abs(t.gastos))}</strong></span>
      <span>📊 Diferencia: <strong class="${diffCls}">${signed(diff)}</strong></span>
      <span>🏢 Saldo 31 dic: <strong class="${saldoCls}">${eur(t.saldoFinal)}</strong></span>
      <span class="analysis-worst-badge">⚠️ Peor mes: ${MESES_ABR[worst.m-1]} (${signed(worstNet)})</span>
      <span class="analysis-lowest-badge">📉 Peor Saldo Fin: ${MESES_ABR[lowestSaldo.m-1]} · <strong class="${lowestSaldoCls}">${eur(lowestSaldo.saldoFin)}</strong></span>
      <span class="analysis-negative-badge">🔻 1.<sup>er</sup> Negativo: ${negativeLabel(firstNegative)}</span>
      <span class="analysis-negative-badge">⬇️ Peor Negativo: ${negativeLabel(worstNegative)}</span>
    </div>`;

    const monthSummaryRows=ms.map((m,i)=>{
      const saldoMesCls=Number(m.saldoFin)>=0?'amount-pos':'amount-neg';
      return `<tr><td><b>${MESES[i]}</b></td><td class="num-cell analysis-income">${eur(m.ingresos)}</td><td class="num-cell analysis-expense">${eur(Math.abs(m.gastosOtros))}</td><td class="num-cell analysis-card">${eur(m.tarjeta)}</td><td class="num-cell ${saldoMesCls}"><b>${eur(m.saldoFin)}</b></td></tr>`;
    });
    const monthSummary=`<div class="analysis-month-summary">${table(['Mes','Ingresos','Gastos cuenta','Tarjeta','Saldo fin'],monthSummaryRows)}</div>`;

    let monthBlocks='';
    for(let m=1;m<=12;m++){
      const entries=sorted.filter(e=>parseDateISO(e.date).getMonth()+1===m);
      if(!entries.length) continue;
      const agg=ms[m-1];
      const net=agg.ingresos+agg.gastosOtros;
      const rows=entries.map(e=>{
        const isCard=/^tarjetas\s+/i.test(String(e.concept||'')) || e.source==='card-total';
        const isIncome=Number(e.amount)>=0;
        const tipo=isCard?'Tarjeta':(isIncome?'Ingreso':'Gasto');
        const amountCls=isCard?'analysis-card':(isIncome?'analysis-income':'analysis-expense');
        const saldoRowCls=Number(e.balance)>=0?'amount-pos':'amount-neg';
        return `<tr><td>${escapeHtml(e.concept||'')}</td><td><span class="analysis-type ${isCard?'card':(isIncome?'income':'expense')}">${tipo}</span></td><td class="num-cell ${amountCls}">${isIncome?'+':''}${eur(e.amount)}</td><td class="num-cell ${saldoRowCls}"><strong>${eur(e.balance)}</strong></td></tr>`;
      });
      const endBalance=entries[entries.length-1].balance;
      const endCls=endBalance>=0?'amount-pos':'amount-neg';
      monthBlocks+=`<div class="analysis-month-block">
        <div class="analysis-month-head"><strong>🔒 ${MESES[m-1]}</strong><span class="analysis-month-pill income">${eur(agg.ingresos)}</span><span class="analysis-month-pill expense">${eur(Math.abs(agg.gastosOtros))}</span><span class="analysis-month-pill ${net>=0?'balance-pos':'balance-neg'}">Balance: ${signed(net)}</span></div>
        ${table(['Concepto','Tipo','Importe','Saldo'],rows)}
        <div class="analysis-month-final ${endCls}">🏁 Saldo a 31 de ${MESES[m-1]} <strong>${eur(endBalance)}</strong></div>
      </div>`;
    }
    host().innerHTML=panel('Desglose Anual',String(y),summary+monthSummary+monthBlocks);
  }
  function renderFlow(){
    const y=Number(ui.year)||years().slice(-1)[0], sorted=getSortedDays(y);
    const entries=sorted.filter(e=>String(e.concept||'').trim());
    let prevMonth=null;
    const rows=entries.map(e=>{
      const d=parseDateISO(e.date);
      const monthKey=`${d.getFullYear()}-${d.getMonth()+1}`;
      const monthStart=prevMonth!==null && monthKey!==prevMonth;
      prevMonth=monthKey;
      const moveCls=Number(e.amount)>=0?'flow-move-pos':'flow-move-neg';
      const saldoCls=Number(e.balance)>=0?'amount-pos':'amount-neg';
      return `<tr class="${monthStart?'flow-month-start':''}"><td>${e.date}</td><td>${escapeHtml(e.concept||'')}</td><td class="num-cell"><span class="flow-move-pill ${moveCls}">${signed(e.amount)}</span></td><td class="num-cell ${saldoCls}"><b>${eur(e.balance)}</b></td></tr>`;
    });
    host().innerHTML=panel('Flujo continuo',`${y} · ${rows.length} movimientos`,table(['Fecha','Concepto','Movimiento','Saldo'],rows));
  }
  function analysisForecastStore(){
    if(!DB.analysisForecasts || typeof DB.analysisForecasts!=='object') DB.analysisForecasts={};
    return DB.analysisForecasts;
  }
  function freezeForecastsIfNeeded(){
    const store=analysisForecastStore();
    const now=new Date();
    const currentYear=now.getFullYear();
    let changed=false;
    years().forEach(y=>{
      if(y<=currentYear && !store[String(y)]){
        store[String(y)]={value:Number(yearTotals(y).saldoFinal)||0,frozenAt:now.toISOString()};
        changed=true;
      }
    });
    if(changed) saveDB();
    return store;
  }
  function analysisYearMetrics(y){
    const sorted=getSortedDays(y).filter(e=>String(e.concept||'').trim());
    const negatives=sorted.filter(e=>Number(e.balance)<0);
    const first=negatives.length?negatives[0]:null;
    const lowest=sorted.length?sorted.reduce((a,b)=>Number(b.balance)<Number(a.balance)?b:a,sorted[0]):null;
    return {sorted,first,lowest};
  }
  function analysisDate(e){
    if(!e) return '—';
    const d=parseDateISO(e.date);
    return `${d.getDate()} ${MESES_ABR[d.getMonth()].toLowerCase()}`;
  }
  function renderAnalysis(){
    const ys=years();
    const store=freezeForecastsIfNeeded();
    const currentYear=new Date().getFullYear();
    const rows=ys.map(y=>{
      const t=yearTotals(y), m=analysisYearMetrics(y);
      const firstText=m.first ? `${analysisDate(m.first)} <span class="analysis-point-amount">${eur(m.first.balance)}</span>` : 'Sin negativo';
      const lowText=m.lowest ? `${analysisDate(m.lowest)} <span class="analysis-point-amount">${eur(m.lowest.balance)}</span>` : '—';
      const firstCls=m.first?'analysis-alert':'analysis-ok';
      const lowCls=m.lowest && Number(m.lowest.balance)<0?'analysis-alert':'analysis-ok';
      const saldoCls=Number(t.saldoFinal)>=0?'amount-pos':'amount-neg';
      const frozen=store[String(y)];
      const forecast= frozen ? Number(frozen.value)||0 : Number(t.saldoFinal)||0;
      const forecastNote=frozen ? 'Fijada' : 'Previsión';
      const diff=frozen ? Number(t.saldoFinal)-forecast : null;
      const diffHtml=diff===null ? '<span class="analysis-muted">—</span>' : `<span class="${diff>=0?'amount-pos':'amount-neg'} analysis-key-value">${signed(diff)}</span>`;
      return `<tr>
        <td>${y}</td>
        <td class="${firstCls}">${firstText}</td>
        <td class="${lowCls}">${lowText}</td>
        <td class="num-cell ${saldoCls} analysis-key-value">${eur(t.saldoFinal)}</td>
        <td class="num-cell"><span class="analysis-forecast-note">${forecastNote}</span> <span class="analysis-forecast-value ${frozen?'analysis-forecast-editable':''}" ${frozen?`data-edit-forecast="${y}" title="Pincha para editar la previsión fijada"`:''}>${eur(forecast)}</span></td>
        <td class="num-cell">${diffHtml}</td>
      </tr>`;
    });
    const note=`<div class="analysis-explain"><b>Previsión:</b> cada año futuro es provisional hasta que llega su 1 de enero. Al entrar por primera vez en la app durante ese año, se fija el saldo previsto a 31 de diciembre y ya no cambia aunque modifiques ingresos o gastos. <b>1.<sup>er</sup> negativo / punto más bajo:</b> se recalculan siempre con el saldo acumulado de cada movimiento. <b>Diferencia:</b> saldo actual a 31 de diciembre menos la previsión fijada; verde significa mejor de lo previsto y rojo, peor.</div>`;
    host().innerHTML=panel('Análisis',`${ys[0]||'—'} - ${ys.slice(-1)[0]||'—'} · seguimiento anual del saldo y la previsión`,table(['Año','1.er negativo','Punto más bajo','Saldo 31 dic','Previsión','Diferencia'],rows)+note);
    host().querySelectorAll('[data-edit-forecast]').forEach(el=>{
      el.addEventListener('click',()=>{
        const year=String(el.dataset.editForecast||'');
        const item=analysisForecastStore()[year];
        if(!item) return;
        const raw=prompt(`Previsión fijada de ${year} (€)`, fmtEditable(Number(item.value)||0));
        if(raw===null) return;
        const value=parseEsNumber(raw);
        if(!Number.isFinite(value)) return;
        item.value=value; item.manualEdit=true; item.frozenAt=item.frozenAt||new Date().toISOString();
        saveDB(); renderAnalysis();
      });
    });
  }
  function comparisonFixedMatch(entry){
    const concept=String(entry?.concept||'');
    let fixed=typeof findFijoMatch==='function' ? findFijoMatch(concept) : null;
    if(fixed) return fixed;
    if(typeof masterMatchesForTemplate==='function'){
      const matches=masterMatchesForTemplate(concept,'cuenta')||[];
      if(matches.length) return matches.find(x=>x.tipo==='vacaciones') || matches[0];
    }
    const base=concept.replace(/\s+(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)$/i,'').trim();
    if(base && Array.isArray(DB.fijos)){
      const norm=typeof normalizeName==='function' ? normalizeName(base) : base.toLowerCase();
      fixed=DB.fijos.find(f=>{
        const fn=typeof normalizeName==='function' ? normalizeName(f.name||'') : String(f.name||'').trim().toLowerCase();
        return fn===norm;
      })||null;
    }
    return fixed;
  }
  function comparisonCategory(entry){
    if(Number(entry.amount)>0) return 'income';
    const fixed=comparisonFixedMatch(entry);
    if(fixed && fixed.tipo==='vacaciones') return 'vacation';
    return 'expense';
  }
  function comparisonConcept(entry){
    const fixed=comparisonFixedMatch(entry);
    if(fixed && fixed.name) return String(fixed.name);
    return String(entry.concept||'').replace(/\s+(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)$/i,'').trim() || 'Sin concepto';
  }
  function comparisonCardCategory(entry){
    if(entry && entry.type==='vacaciones') return 'vacation';
    if(entry && entry.type==='gasto') return 'expense';
    if(typeof masterMatchesForTemplate==='function'){
      const matches=masterMatchesForTemplate(String(entry?.category||''),'tarjeta')||[];
      if(matches.some(x=>x.tipo==='vacaciones')) return 'vacation';
    }
    return 'expense';
  }
  function comparisonMatrix(yearList, mode){
    const cats={income:new Map(),expense:new Map(),vacation:new Map()};
    const totals={income:Array(yearList.length).fill(0),expense:Array(yearList.length).fill(0),vacation:Array(yearList.length).fill(0)};
    yearList.forEach((key,col)=>{
      const y=mode==='months'?Number(ui.year):Number(key);
      // Cuenta: excluimos las lineas agregadas "Tarjetas Mes" porque debajo
      // incorporamos cada categoria real de tarjeta por separado.
      getSortedDays(y).filter(e=>String(e.concept||'').trim() && !(/^tarjetas\s+/i.test(String(e.concept||'')) || e.source==='card-total')).forEach(e=>{
        const slot=mode==='months' ? parseDateISO(e.date).getMonth() : col;
        if(mode==='months' && slot!==col) return;
        const cat=comparisonCategory(e), name=comparisonConcept(e), value=Math.abs(Number(e.amount)||0);
        if(!cats[cat].has(name)) cats[cat].set(name,Array(yearList.length).fill(null));
        const arr=cats[cat].get(name); arr[col]=(arr[col]||0)+value; totals[cat][col]+=value;
      });
      // Tarjeta: cada categoria es un concepto independiente y conserva Gasto/Vacaciones.
      const yd=ensureYear(y);
      (yd.cardEntries||[]).forEach(c=>{
        const slot=mode==='months' ? Number(c.month)-1 : col;
        if(mode==='months' && slot!==col) return;
        const cat=comparisonCardCategory(c), name=String(c.category||'').trim()||'Sin concepto', value=Math.abs(Number(c.amount)||0);
        if(!cats[cat].has(name)) cats[cat].set(name,Array(yearList.length).fill(null));
        const arr=cats[cat].get(name); arr[col]=(arr[col]||0)+value; totals[cat][col]+=value;
      });
    });
    return {cats,totals};
  }
  function comparisonBlock(title,cat,matrix,headers){
    const map=matrix.cats[cat], total=matrix.totals[cat];
    const cls=cat==='income'?'compare-income':cat==='vacation'?'compare-vacation':'compare-expense';
    const rows=[];
    rows.push(`<tr class="compare-total ${cls}"><td>${title}</td>${total.map(v=>`<td class="num-cell">${v?eur(v):''}</td>`).join('')}</tr>`);
    Array.from(map.entries()).sort((a,b)=>a[0].localeCompare(b[0],'es')).forEach(([name,vals])=>{
      rows.push(`<tr data-compare-concept="${escapeHtml(name.toLowerCase())}"><td>${escapeHtml(name)}</td>${vals.map(v=>`<td class="num-cell ${cls}">${v?eur(v):''}</td>`).join('')}</tr>`);
    });
    return rows;
  }
  function renderComparison(mode){
    const isMonths=mode==='months';
    const y=Number(ui.year)||years().slice(-1)[0];
    const headers=isMonths?MESES_ABR:years().map(String);
    const keys=isMonths?Array.from({length:12},(_,i)=>i):years();
    const matrix=comparisonMatrix(keys,mode);
    const rows=[
      ...comparisonBlock('INGRESOS','income',matrix,headers),
      ...comparisonBlock('GASTOS','expense',matrix,headers),
      ...comparisonBlock('VACACIONES','vacation',matrix,headers)
    ];
    const search=`<div class="compare-search"><input id="compareSearch" class="field" type="search" placeholder="🔎 Buscar concepto"></div>`;
    const title=isMonths?'Comparar 12 meses':'Comparar años';
    const sub=isMonths?String(y):'Suma anual por concepto';
    host().innerHTML=panel(title,sub,search+table(['Concepto',...headers],rows));
    if(!isMonths){
      const wrap=host().querySelector('.analysis-table-wrap');
      if(wrap) wrap.classList.add('compare-years-scroll');
    }
    const input=document.getElementById('compareSearch');
    input.addEventListener('input',()=>{
      const q=String(input.value||'').trim().toLowerCase();
      host().querySelectorAll('[data-compare-concept]').forEach(tr=>{tr.style.display=!q||tr.dataset.compareConcept.includes(q)?'':'none';});
    });
  }
  function renderMonths(){ renderComparison('months'); }
  function renderYears(){ renderComparison('years'); }
  function renderSim(){
    const baseYear=Number(ui.year)||new Date().getFullYear();
    const firstYear=baseYear+1;
    const lastYear=Math.max(2040,...years());
    const simYears=[]; for(let y=firstYear;y<=lastYear;y++) simYears.push(y);
    if(!simYears.length){ host().innerHTML=panel('Simular',String(baseYear),'No hay años posteriores para simular.'); return; }

    const controls=`<div class="sim-controls">
      <label>Ingresos % <input id="simIng" class="field" type="number" value="0" step="0.5"></label>
      <label>Gastos % <input id="simGas" class="field" type="number" value="0" step="0.5"></label>
      <label>Vacaciones % <input id="simVac" class="field" type="number" value="0" step="0.5"></label>
      <button class="btn primary" id="simRun">Calcular</button>
    </div><div class="sim-note">La simulación comienza en ${firstYear} usando como punto de partida el saldo previsto a 31/12/${baseYear}. Los porcentajes se aplican sobre los importes que ya tiene cada año.</div><div id="simOut"></div>`;
    host().innerHTML=panel('Simular',`${firstYear}–${lastYear}`,controls);

    const run=()=>{
      const pi=(Number(document.getElementById('simIng').value)||0)/100;
      const pg=(Number(document.getElementById('simGas').value)||0)/100;
      const pv=(Number(document.getElementById('simVac').value)||0)/100;
      let start=yearTotals(baseYear).saldoFinal;
      const rows=[];
      simYears.forEach(y=>{
        const matrix=comparisonMatrix([y],'years');
        const ingresos=Number(matrix.totals.income[0]||0)*(1+pi);
        const gastos=Number(matrix.totals.expense[0]||0)*(1+pg);
        const vacaciones=Number(matrix.totals.vacation[0]||0)*(1+pv);
        const ahorro=ingresos-gastos-vacaciones;
        const saldo=start+ahorro;
        const ahorroCls=ahorro>=0?'amount-pos':'amount-neg';
        const saldoCls=saldo>=0?'amount-pos':'amount-neg';
        rows.push(`<tr><td><b>${y}</b></td><td class="num-cell">${eur(start)}</td><td class="num-cell analysis-income">${eur(ingresos)}</td><td class="num-cell analysis-expense">${eur(gastos)}</td><td class="num-cell compare-vacation">${eur(vacaciones)}</td><td class="num-cell ${ahorroCls}">${signed(ahorro)}</td><td class="num-cell ${saldoCls}"><b>${eur(saldo)}</b></td></tr>`);
        start=saldo;
      });
      document.getElementById('simOut').innerHTML=table(['Año',`Saldo 31 dic. año anterior`,'Ingresos simulados','Gastos simulados','Vacaciones simuladas','Ahorro','Saldo final simulado'],rows);
    };
    document.getElementById('simRun').onclick=run;
    ['simIng','simGas','simVac'].forEach(id=>document.getElementById(id).addEventListener('change',run));
    run();
  }
  const renders={global:renderGlobal,annual:renderAnnual,flow:renderFlow,analysis:renderAnalysis,months:renderMonths,years:renderYears,simulate:renderSim};
  let active='global';
  function setMode(mode){
    const analysis=mode==='analysis';
    document.getElementById('dayTabs').style.display=analysis?'none':'flex';
    document.getElementById('analysisTabs').style.display=analysis?'flex':'none';
    host().style.display=analysis?'block':'none';
    document.querySelectorAll('.view').forEach(v=>{ if(analysis)v.style.display='none'; else v.style.display=''; });
    document.getElementById('modeDay').className='btn '+(!analysis?'primary':'ghost');
    document.getElementById('modeAnalysis').className='btn '+(analysis?'primary':'ghost');
    if(analysis) renders[active](); else { const a=document.querySelector('.view.active'); if(a)a.style.display='block'; }
  }
  document.getElementById('modeDay').onclick=()=>setMode('day');
  document.getElementById('modeAnalysis').onclick=()=>setMode('analysis');
  document.querySelectorAll('#analysisTabs [data-analysis]').forEach(b=>b.onclick=()=>{document.querySelectorAll('#analysisTabs [data-analysis]').forEach(x=>x.classList.remove('active'));b.classList.add('active');active=b.dataset.analysis;renders[active]();});
  const oldRenderAll=renderAll; renderAll=function(){oldRenderAll(); if(host().style.display==='block') renders[active]();};
})();
