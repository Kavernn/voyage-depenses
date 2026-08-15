import React, {useEffect, useMemo, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Plus, Trash2, Pencil, X, Plane, Wallet, ArrowRight, RefreshCw} from 'lucide-react';
import './styles.css';

const KEY='voyage-depenses-v1';
const CURRENCIES=['CAD','EUR','ALL','MKD','USD','GBP','CHF'];
const DEFAULT_CATS=['Hébergement','Restaurants','Épicerie','Transport','Activités','Magasinage','Alcool','Essence','Frais bancaires','Autre'];

const uid=()=>crypto.randomUUID?.() || Math.random().toString(36).slice(2);
const money=n=>new Intl.NumberFormat('fr-CA',{style:'currency',currency:'CAD'}).format(n||0);

function load(){
  try { return JSON.parse(localStorage.getItem(KEY)) || null } catch { return null }
}
function App(){
  const [data,setData]=useState(load() || {
    trip:{name:'Mon voyage',start:'',end:'',countries:'',budget:''},
    people:['Moi','Mon conjoint'],
    categories:DEFAULT_CATS,
    expenses:[]
  });
  const [screen,setScreen]=useState('dashboard');
  const [showTrip,setShowTrip]=useState(false);
  const [showExpense,setShowExpense]=useState(false);
  const [editing,setEditing]=useState(null);
  const [rates,setRates]=useState({CAD:1});
  const [rateStatus,setRateStatus]=useState('Prêt');
  const [form,setForm]=useState(null);

  useEffect(()=>localStorage.setItem(KEY,JSON.stringify(data)),[data]);

  async function getRate(currency){
    if(currency==='CAD') return 1;
    if(rates[currency]) return rates[currency];
    try{
      setRateStatus('Taux en cours de récupération…');
      const r=await fetch(`https://open.er-api.com/v6/latest/${currency}`);
      const j=await r.json();
      const rate=j?.rates?.CAD;
      if(!rate) throw new Error();
      setRates(x=>({...x,[currency]:rate}));
      setRateStatus(`Taux ${currency}/CAD: ${rate}`);
      return rate;
    }catch{
      setRateStatus('Impossible de récupérer le taux. Entrez-le manuellement.');
      return null;
    }
  }

  function newExpense(){
    setEditing(null);
    setForm({amount:'',currency:'CAD',payer:data.people[0],category:data.categories[0],description:'',date:new Date().toISOString().slice(0,10),place:'',personal:false,split:50,customOther:50,rate:''});
    setShowExpense(true);
  }

  async function saveExpense(e){
    e.preventDefault();
    const amount=Number(form.amount);
    if(!amount) return;
    let rate=form.currency==='CAD'?1:Number(form.rate)||await getRate(form.currency);
    if(!rate) return;
    const expense={...form,id:editing?.id||uid(),amount,rate,cad:amount*rate};
    setData(d=>({...d,expenses:editing?d.expenses.map(x=>x.id===editing.id?expense:x):[expense,...d.expenses]}));
    setShowExpense(false); setForm(null);
  }

  const stats=useMemo(()=>{
    const total=data.expenses.reduce((s,e)=>s+e.cad,0);
    const personal=data.expenses.filter(e=>e.personal);
    const shared=data.expenses.filter(e=>!e.personal);
    const paid=Object.fromEntries(data.people.map(p=>[p, data.expenses.filter(e=>e.payer===p).reduce((s,e)=>s+e.cad,0)]));
    const owedBy=Object.fromEntries(data.people.map(p=>[p,0]));
    shared.forEach(e=>{
      const a=data.people[0], b=data.people[1];
      const pct=e.split/100;
      if(e.payer===a){ owedBy[b]+=e.cad*pct; owedBy[a]-=e.cad*pct; }
      else { owedBy[a]+=e.cad*(1-pct); owedBy[b]-=e.cad*(1-pct); }
    });
    const net=owedBy[data.people[0]]||0;
    const budget=Number(data.trip.budget)||0;
    return {total,sharedTotal:shared.reduce((s,e)=>s+e.cad,0),personalTotal:personal.reduce((s,e)=>s+e.cad,0),paid,net,budget,remaining:budget-total};
  },[data]);

  function deleteExpense(id){ if(confirm('Supprimer cette dépense ?')) setData(d=>({...d,expenses:d.expenses.filter(e=>e.id!==id)})); }
  function editExpense(e){setEditing(e);setForm({...e});setShowExpense(true)}

  return <div className="app">
    <header><div className="brand"><Plane size={22}/> Voyage Dépenses</div><button className="iconBtn" onClick={()=>setShowTrip(true)} title="Voyage"><Wallet size={20}/></button></header>
    <main>
      {screen==='dashboard' && <Dashboard data={data} stats={stats} onAdd={newExpense} onHistory={()=>setScreen('history')} onTrip={()=>setShowTrip(true)}/>}
      {screen==='history' && <History data={data} onBack={()=>setScreen('dashboard')} onEdit={editExpense} onDelete={deleteExpense}/>}
    </main>
    <nav><button className={screen==='dashboard'?'active':''} onClick={()=>setScreen('dashboard')}>Tableau de bord</button><button className={screen==='history'?'active':''} onClick={()=>setScreen('history')}>Dépenses</button><button className="add" onClick={newExpense}><Plus/></button></nav>

    {showTrip && <Modal title="Mon voyage" close={()=>setShowTrip(false)}>
      <form onSubmit={e=>{e.preventDefault();setShowTrip(false)}} className="form">
        {['name','start','end','countries','budget'].map(k=><label key={k}>{({name:'Nom du voyage',start:'Date de début',end:'Date de fin',countries:'Pays visités',budget:'Budget total (CAD)'})[k]}<input type={k.includes('date')||['start','end'].includes(k)?'date':'text'} inputMode={k==='budget'?'decimal':undefined} value={data.trip[k]} onChange={e=>setData(d=>({...d,trip:{...d.trip,[k]:e.target.value}}) )}/></label>)}
        <button className="primary">Enregistrer</button>
      </form>
    </Modal>}

    {showExpense && form && <Modal title={editing?'Modifier la dépense':'Ajouter une dépense'} close={()=>setShowExpense(false)}>
      <form onSubmit={saveExpense} className="form">
        <label>Montant<input autoFocus required type="number" step="0.01" value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})}/></label>
        <div className="grid2"><label>Devise<select value={form.currency} onChange={e=>setForm({...form,currency:e.target.value,rate:''})}>{CURRENCIES.map(c=><option key={c}>{c}</option>)}</select></label><label>Payé par<select value={form.payer} onChange={e=>setForm({...form,payer:e.target.value})}>{data.people.map(p=><option key={p}>{p}</option>)}</select></label></div>
        <div className="grid2"><label>Catégorie<select value={form.category} onChange={e=>setForm({...form,category:e.target.value})}>{data.categories.map(c=><option key={c}>{c}</option>)}</select></label><label>Date<input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></label></div>
        <label>Description (facultatif)<input value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label>
        <label>Lieu (facultatif)<input value={form.place} onChange={e=>setForm({...form,place:e.target.value})}/></label>
        <label className="check"><input type="checkbox" checked={form.personal} onChange={e=>setForm({...form,personal:e.target.checked})}/> Dépense personnelle</label>
        {!form.personal && <label>Part de {data.people[0]}: <b>{form.split}%</b><input type="range" min="0" max="100" step="10" value={form.split} onChange={e=>setForm({...form,split:Number(e.target.value)})}/><small>{data.people[0]} {form.split}% / {data.people[1]} {100-form.split}%</small></label>}
        {form.currency!=='CAD' && <label>Taux CAD (laisser vide = automatique)<input type="number" step="0.000001" placeholder="Ex. 1.61" value={form.rate} onChange={e=>setForm({...form,rate:e.target.value})}/></label>}
        <div className="rate">{rateStatus}</div>
        <button className="primary">Enregistrer la dépense</button>
      </form>
    </Modal>}
  </div>
}

function Dashboard({data,stats,onAdd,onHistory,onTrip}){
  const pct=stats.budget?Math.min(100,stats.total/stats.budget*100):0;
  const debtor=stats.net>0?data.people[1]:data.people[0];
  const creditor=stats.net>0?data.people[0]:data.people[1];
  return <section>
    <div className="hero"><div><p className="eyebrow">{data.trip.start&&data.trip.end?`${data.trip.start} → ${data.trip.end}`:'Nouveau voyage'}</p><h1>{data.trip.name}</h1><p>{data.trip.countries||'Configure ton voyage pour commencer.'}</p></div><button onClick={onTrip}>Modifier</button></div>
    <div className="cards"><div><span>Dépenses</span><strong>{money(stats.total)}</strong></div><div><span>Budget restant</span><strong>{stats.budget?money(stats.remaining):'—'}</strong></div></div>
    {stats.budget>0&&<div className="budget"><div><span>Budget utilisé</span><b>{pct.toFixed(1)}%</b></div><div className="bar"><i style={{width:`${pct}%`}}/></div></div>}
    <div className="balance"><span>Solde entre vous</span><strong>{Math.abs(stats.net)<0.005?'Vous êtes à égalité':`${debtor} doit ${money(Math.abs(stats.net))} à ${creditor}`}</strong></div>
    <div className="people">{data.people.map(p=><div key={p}><span>{p}</span><b>{money(stats.paid[p])}</b></div>)}</div>
    <button className="primary big" onClick={onAdd}><Plus/> Ajouter une dépense</button>
    <button className="secondary big" onClick={onHistory}>Voir l'historique ({data.expenses.length})</button>
  </section>
}

function History({data,onBack,onEdit,onDelete}){
  return <section><div className="topline"><button onClick={onBack}>← Retour</button><h2>Dépenses</h2></div>
  {data.expenses.length===0?<div className="empty">Aucune dépense pour le moment.</div>:<div className="list">{data.expenses.map(e=><div className="expense" key={e.id}><div><b>{e.description||e.category}</b><small>{e.date} · {e.payer} · {e.personal?'Personnel':'Partagé'}</small><small>{e.amount.toFixed(2)} {e.currency} → {money(e.cad)}</small></div><div className="actions"><button onClick={()=>onEdit(e)}><Pencil size={17}/></button><button onClick={()=>onDelete(e.id)}><Trash2 size={17}/></button></div></div>)}</div>}</section>
}

function Modal({title,close,children}){return <div className="overlay"><div className="modal"><div className="modalHead"><h2>{title}</h2><button onClick={close}><X/></button></div>{children}</div></div>}

createRoot(document.getElementById('root')).render(<App/>);
