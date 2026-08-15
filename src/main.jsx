import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Plus,
  Trash2,
  Pencil,
  X,
  Plane,
  Wallet
} from 'lucide-react';
import { supabase } from './lib/supabase';
import './styles.css';

const CURRENCIES = ['CAD', 'EUR', 'ALL', 'MKD', 'USD', 'GBP', 'CHF'];

const DEFAULT_CATS = [
  'Hébergement',
  'Restaurants',
  'Épicerie',
  'Transport',
  'Activités',
  'Magasinage',
  'Alcool',
  'Essence',
  'Frais bancaires',
  'Autre'
];

const money = (n) =>
  new Intl.NumberFormat('fr-CA', {
    style: 'currency',
    currency: 'CAD'
  }).format(n || 0);

const today = () => new Date().toISOString().slice(0, 10);

function App() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [tripId, setTripId] = useState(null);

  const [data, setData] = useState({
    trip: {
      name: 'Mon voyage',
      start: '',
      end: '',
      countries: '',
      budget: ''
    },
    people: ['Moi', 'Mon conjoint'],
    categories: DEFAULT_CATS,
    expenses: []
  });

  const [screen, setScreen] = useState('dashboard');
  const [showTrip, setShowTrip] = useState(false);
  const [showExpense, setShowExpense] = useState(false);
  const [editing, setEditing] = useState(null);
  const [rates, setRates] = useState({ CAD: 1 });
  const [rateStatus, setRateStatus] = useState('Prêt');
  const [form, setForm] = useState(null);

  useEffect(() => {
    loadFromSupabase();
  }, []);

  async function loadFromSupabase() {
    try {
      setLoading(true);
      setError('');

      let { data: trips, error: tripError } = await supabase
        .from('trips')
        .select('*')
        .order('created_at', { ascending: true })
        .limit(1);

      if (tripError) throw tripError;

      let trip = trips?.[0];

      if (!trip) {
        const { data: createdTrip, error: createError } = await supabase
          .from('trips')
          .insert({
            name: 'Mon voyage'
          })
          .select()
          .single();

        if (createError) throw createError;

        trip = createdTrip;

        const { error: participantError } = await supabase
          .from('participants')
          .insert([
            {
              trip_id: trip.id,
              name: 'Moi'
            },
            {
              trip_id: trip.id,
              name: 'Mon conjoint'
            }
          ]);

        if (participantError) throw participantError;
      }

      setTripId(trip.id);

      const [
        { data: participants, error: participantsError },
        { data: expenses, error: expensesError }
      ] = await Promise.all([
        supabase
          .from('participants')
          .select('*')
          .eq('trip_id', trip.id)
          .order('created_at', { ascending: true }),

        supabase
          .from('expenses')
          .select('*')
          .eq('trip_id', trip.id)
          .order('expense_date', { ascending: false })
      ]);

      if (participantsError) throw participantsError;
      if (expensesError) throw expensesError;

      const people =
        participants?.length > 0
          ? participants.map((p) => p.name)
          : ['Moi', 'Mon conjoint'];

      setData({
        trip: {
          name: trip.name || 'Mon voyage',
          start: trip.start_date || '',
          end: trip.end_date || '',
          countries: trip.countries || '',
          budget: trip.budget ?? ''
        },
        people,
        categories: DEFAULT_CATS,
        expenses: (expenses || []).map(dbExpenseToApp)
      });
    } catch (err) {
      console.error(err);
      setError(
        err?.message ||
          'Impossible de charger les données Supabase.'
      );
    } finally {
      setLoading(false);
    }
  }

  function dbExpenseToApp(e) {
    return {
      id: e.id,
      amount: Number(e.amount),
      currency: e.currency,
      rate: Number(e.exchange_rate),
      cad: Number(e.amount_cad),
      payer: e.payer,
      category: e.category,
      description: e.description || '',
      place: e.place || '',
      date: e.expense_date,
      personal: e.personal,
      split: Number(e.split_percentage ?? 50)
    };
  }

  async function saveTrip(e) {
    e.preventDefault();

    if (!tripId) return;

    try {
      setSaving(true);
      setError('');

      const { error: updateError } = await supabase
        .from('trips')
        .update({
          name: data.trip.name || 'Mon voyage',
          start_date: data.trip.start || null,
          end_date: data.trip.end || null,
          countries: data.trip.countries || null,
          budget:
            data.trip.budget === ''
              ? null
              : Number(data.trip.budget)
        })
        .eq('id', tripId);

      if (updateError) throw updateError;

      setShowTrip(false);
    } catch (err) {
      console.error(err);
      setError(err?.message || 'Erreur lors de la sauvegarde.');
    } finally {
      setSaving(false);
    }
  }

  async function getRate(currency) {
    if (currency === 'CAD') return 1;

    if (rates[currency]) {
      return rates[currency];
    }

    try {
      setRateStatus('Taux en cours de récupération…');

      const response = await fetch(
        `https://open.er-api.com/v6/latest/${currency}`
      );

      const json = await response.json();
      const rate = json?.rates?.CAD;

      if (!rate) {
        throw new Error('Taux introuvable');
      }

      setRates((current) => ({
        ...current,
        [currency]: rate
      }));

      setRateStatus(`Taux ${currency}/CAD : ${rate}`);

      return rate;
    } catch {
      setRateStatus(
        'Impossible de récupérer le taux. Entrez-le manuellement.'
      );

      return null;
    }
  }

  function newExpense() {
    setEditing(null);

    setForm({
      amount: '',
      currency: 'CAD',
      payer: data.people[0],
      category: data.categories[0],
      description: '',
      date: today(),
      place: '',
      personal: false,
      split: 50,
      rate: ''
    });

    setShowExpense(true);
  }

  async function saveExpense(e) {
    e.preventDefault();

    if (!tripId) return;

    const amount = Number(form.amount);

    if (!amount) return;

    try {
      setSaving(true);
      setError('');

      const rate =
        form.currency === 'CAD'
          ? 1
          : Number(form.rate) || (await getRate(form.currency));

      if (!rate) return;

      const payload = {
        trip_id: tripId,
        amount,
        currency: form.currency,
        exchange_rate: rate,
        amount_cad: amount * rate,
        payer: form.payer,
        category: form.category,
        description: form.description || null,
        place: form.place || null,
        expense_date: form.date,
        personal: form.personal,
        split_percentage: form.split
      };

      if (editing) {
        const { data: updated, error: updateError } = await supabase
          .from('expenses')
          .update(payload)
          .eq('id', editing.id)
          .select()
          .single();

        if (updateError) throw updateError;

        setData((current) => ({
          ...current,
          expenses: current.expenses.map((expense) =>
            expense.id === editing.id
              ? dbExpenseToApp(updated)
              : expense
          )
        }));
      } else {
        const { data: created, error: insertError } = await supabase
          .from('expenses')
          .insert(payload)
          .select()
          .single();

        if (insertError) throw insertError;

        setData((current) => ({
          ...current,
          expenses: [
            dbExpenseToApp(created),
            ...current.expenses
          ]
        }));
      }

      setShowExpense(false);
      setForm(null);
      setEditing(null);
    } catch (err) {
      console.error(err);
      setError(
        err?.message ||
          'Impossible de sauvegarder la dépense.'
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteExpense(id) {
    if (!confirm('Supprimer cette dépense ?')) return;

    try {
      setSaving(true);
      setError('');

      const { error: deleteError } = await supabase
        .from('expenses')
        .delete()
        .eq('id', id);

      if (deleteError) throw deleteError;

      setData((current) => ({
        ...current,
        expenses: current.expenses.filter(
          (expense) => expense.id !== id
        )
      }));
    } catch (err) {
      console.error(err);
      setError(
        err?.message ||
          'Impossible de supprimer la dépense.'
      );
    } finally {
      setSaving(false);
    }
  }

  function editExpense(expense) {
    setEditing(expense);
    setForm({
      ...expense,
      rate: expense.currency === 'CAD' ? '' : expense.rate
    });
    setShowExpense(true);
  }

  const stats = useMemo(() => {
    const total = data.expenses.reduce(
      (sum, expense) => sum + expense.cad,
      0
    );

    const personal = data.expenses.filter(
      (expense) => expense.personal
    );

    const shared = data.expenses.filter(
      (expense) => !expense.personal
    );

    const paid = Object.fromEntries(
      data.people.map((person) => [
        person,
        data.expenses
          .filter((expense) => expense.payer === person)
          .reduce((sum, expense) => sum + expense.cad, 0)
      ])
    );

    const owedBy = Object.fromEntries(
      data.people.map((person) => [person, 0])
    );

    if (data.people.length >= 2) {
      shared.forEach((expense) => {
        const a = data.people[0];
        const b = data.people[1];

        const pct = expense.split / 100;

        if (expense.payer === a) {
          owedBy[b] += expense.cad * pct;
          owedBy[a] -= expense.cad * pct;
        } else {
          owedBy[a] += expense.cad * (1 - pct);
          owedBy[b] -= expense.cad * (1 - pct);
        }
      });
    }

    const net = owedBy[data.people[0]] || 0;

    const budget = Number(data.trip.budget) || 0;

    return {
      total,
      sharedTotal: shared.reduce(
        (sum, expense) => sum + expense.cad,
        0
      ),
      personalTotal: personal.reduce(
        (sum, expense) => sum + expense.cad,
        0
      ),
      paid,
      net,
      budget,
      remaining: budget - total
    };
  }, [data]);

  if (loading) {
    return (
      <div className="app">
        <main>
          <div className="empty">
            Chargement de ton voyage…
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <header>
        <div className="brand">
          <Plane size={22} />
          Voyage Dépenses
        </div>

        <button
          className="iconBtn"
          onClick={() => setShowTrip(true)}
          title="Voyage"
        >
          <Wallet size={20} />
        </button>
      </header>

      {error && (
        <div className="error">
          {error}
        </div>
      )}

      {saving && (
        <div className="saving">
          Sauvegarde…
        </div>
      )}

      <main>
        {screen === 'dashboard' && (
          <Dashboard
            data={data}
            stats={stats}
            onAdd={newExpense}
            onHistory={() => setScreen('history')}
            onTrip={() => setShowTrip(true)}
          />
        )}

        {screen === 'history' && (
          <History
            data={data}
            onBack={() => setScreen('dashboard')}
            onEdit={editExpense}
            onDelete={deleteExpense}
          />
        )}
      </main>

      <nav>
        <button
          className={screen === 'dashboard' ? 'active' : ''}
          onClick={() => setScreen('dashboard')}
        >
          Tableau de bord
        </button>

        <button
          className={screen === 'history' ? 'active' : ''}
          onClick={() => setScreen('history')}
        >
          Dépenses
        </button>

        <button
          className="add"
          onClick={newExpense}
        >
          <Plus />
        </button>
      </nav>

      {showTrip && (
        <Modal
          title="Mon voyage"
          close={() => setShowTrip(false)}
        >
          <form
            onSubmit={saveTrip}
            className="form"
          >
            <label>
              Nom du voyage
              <input
                type="text"
                value={data.trip.name}
                onChange={(e) =>
                  setData((current) => ({
                    ...current,
                    trip: {
                      ...current.trip,
                      name: e.target.value
                    }
                  }))
                }
              />
            </label>

            <label>
              Date de début
              <input
                type="date"
                value={data.trip.start}
                onChange={(e) =>
                  setData((current) => ({
                    ...current,
                    trip: {
                      ...current.trip,
                      start: e.target.value
                    }
                  }))
                }
              />
            </label>

            <label>
              Date de fin
              <input
                type="date"
                value={data.trip.end}
                onChange={(e) =>
                  setData((current) => ({
                    ...current,
                    trip: {
                      ...current.trip,
                      end: e.target.value
                    }
                  }))
                }
              />
            </label>

            <label>
              Pays visités
              <input
                type="text"
                value={data.trip.countries}
                onChange={(e) =>
                  setData((current) => ({
                    ...current,
                    trip: {
                      ...current.trip,
                      countries: e.target.value
                    }
                  }))
                }
              />
            </label>

            <label>
              Budget total (CAD)
              <input
                type="number"
                step="0.01"
                value={data.trip.budget}
                onChange={(e) =>
                  setData((current) => ({
                    ...current,
                    trip: {
                      ...current.trip,
                      budget: e.target.value
                    }
                  }))
                }
              />
            </label>

            <button
              className="primary"
              disabled={saving}
            >
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </form>
        </Modal>
      )}

      {showExpense && form && (
        <Modal
          title={
            editing
              ? 'Modifier la dépense'
              : 'Ajouter une dépense'
          }
          close={() => setShowExpense(false)}
        >
          <form
            onSubmit={saveExpense}
            className="form"
          >
            <label>
              Montant
              <input
                autoFocus
                required
                type="number"
                step="0.01"
                value={form.amount}
                onChange={(e) =>
                  setForm({
                    ...form,
                    amount: e.target.value
                  })
                }
              />
            </label>

            <div className="grid2">
              <label>
                Devise
                <select
                  value={form.currency}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      currency: e.target.value,
                      rate: ''
                    })
                  }
                >
                  {CURRENCIES.map((currency) => (
                    <option
                      key={currency}
                      value={currency}
                    >
                      {currency}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Payé par
                <select
                  value={form.payer}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      payer: e.target.value
                    })
                  }
                >
                  {data.people.map((person) => (
                    <option
                      key={person}
                      value={person}
                    >
                      {person}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid2">
              <label>
                Catégorie
                <select
                  value={form.category}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      category: e.target.value
                    })
                  }
                >
                  {data.categories.map((category) => (
                    <option
                      key={category}
                      value={category}
                    >
                      {category}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Date
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      date: e.target.value
                    })
                  }
                />
              </label>
            </div>

            <label>
              Description (facultatif)
              <input
                value={form.description}
                onChange={(e) =>
                  setForm({
                    ...form,
                    description: e.target.value
                  })
                }
              />
            </label>

            <label>
              Lieu (facultatif)
              <input
                value={form.place}
                onChange={(e) =>
                  setForm({
                    ...form,
                    place: e.target.value
                  })
                }
              />
            </label>

            <label className="check">
              <input
                type="checkbox"
                checked={form.personal}
                onChange={(e) =>
                  setForm({
                    ...form,
                    personal: e.target.checked
                  })
                }
              />
              Dépense personnelle
            </label>

            {!form.personal && data.people.length >= 2 && (
              <label>
                Part de {data.people[0]} :{' '}
                <b>{form.split}%</b>

                <input
                  type="range"
                  min="0"
                  max="100"
                  step="10"
                  value={form.split}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      split: Number(e.target.value)
                    })
                  }
                />

                <small>
                  {data.people[0]} {form.split}% /{' '}
                  {data.people[1]} {100 - form.split}%
                </small>
              </label>
            )}

            {form.currency !== 'CAD' && (
              <label>
                Taux CAD
                <small>
                  Laisser vide pour récupérer automatiquement
                </small>

                <input
                  type="number"
                  step="0.000001"
                  placeholder="Ex. 1.61"
                  value={form.rate}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      rate: e.target.value
                    })
                  }
                />
              </label>
            )}

            <div className="rate">
              {rateStatus}
            </div>

            <button
              className="primary"
              disabled={saving}
            >
              {saving
                ? 'Enregistrement…'
                : 'Enregistrer la dépense'}
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}

function Dashboard({
  data,
  stats,
  onAdd,
  onHistory,
  onTrip
}) {
  const pct = stats.budget
    ? Math.min(
        100,
        (stats.total / stats.budget) * 100
      )
    : 0;

  const debtor =
    stats.net > 0
      ? data.people[1]
      : data.people[0];

  const creditor =
    stats.net > 0
      ? data.people[0]
      : data.people[1];

  return (
    <section>
      <div className="hero">
        <div>
          <p className="eyebrow">
            {data.trip.start && data.trip.end
              ? `${data.trip.start} → ${data.trip.end}`
              : 'Nouveau voyage'}
          </p>

          <h1>{data.trip.name}</h1>

          <p>
            {data.trip.countries ||
              'Configure ton voyage pour commencer.'}
          </p>
        </div>

        <button onClick={onTrip}>
          Modifier
        </button>
      </div>

      <div className="cards">
        <div>
          <span>Dépenses</span>
          <strong>{money(stats.total)}</strong>
        </div>

        <div>
          <span>Budget restant</span>
          <strong>
            {stats.budget
              ? money(stats.remaining)
              : '—'}
          </strong>
        </div>
      </div>

      {stats.budget > 0 && (
        <div className="budget">
          <div>
            <span>Budget utilisé</span>
            <b>{pct.toFixed(1)}%</b>
          </div>

          <div className="bar">
            <i
              style={{
                width: `${pct}%`
              }}
            />
          </div>
        </div>
      )}

      <div className="balance">
        <span>Solde entre vous</span>

        <strong>
          {Math.abs(stats.net) < 0.005
            ? 'Vous êtes à égalité'
            : `${debtor} doit ${money(
                Math.abs(stats.net)
              )} à ${creditor}`}
        </strong>
      </div>

      <div className="people">
        {data.people.map((person) => (
          <div key={person}>
            <span>{person}</span>
            <b>{money(stats.paid[person])}</b>
          </div>
        ))}
      </div>

      <button
        className="primary big"
        onClick={onAdd}
      >
        <Plus />
        Ajouter une dépense
      </button>

      <button
        className="secondary big"
        onClick={onHistory}
      >
        Voir l'historique ({data.expenses.length})
      </button>
    </section>
  );
}

function History({
  data,
  onBack,
  onEdit,
  onDelete
}) {
  return (
    <section>
      <div className="topline">
        <button onClick={onBack}>
          ← Retour
        </button>

        <h2>Dépenses</h2>
      </div>

      {data.expenses.length === 0 ? (
        <div className="empty">
          Aucune dépense pour le moment.
        </div>
      ) : (
        <div className="list">
          {data.expenses.map((expense) => (
            <div
              className="expense"
              key={expense.id}
            >
              <div>
                <b>
                  {expense.description ||
                    expense.category}
                </b>

                <small>
                  {expense.date} · {expense.payer} ·{' '}
                  {expense.personal
                    ? 'Personnel'
                    : 'Partagé'}
                </small>

                <small>
                  {expense.amount.toFixed(2)}{' '}
                  {expense.currency} →{' '}
                  {money(expense.cad)}
                </small>
              </div>

              <div className="actions">
                <button
                  onClick={() =>
                    onEdit(expense)
                  }
                >
                  <Pencil size={17} />
                </button>

                <button
                  onClick={() =>
                    onDelete(expense.id)
                  }
                >
                  <Trash2 size={17} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Modal({
  title,
  close,
  children
}) {
  return (
    <div className="overlay">
      <div className="modal">
        <div className="modalHead">
          <h2>{title}</h2>

          <button onClick={close}>
            <X />
          </button>
        </div>

        {children}
      </div>
    </div>
  );
}

createRoot(
  document.getElementById('root')
).render(<App />);