import React, { useEffect, useMemo, useState } from "react";
import Modal from "./components/Modal";
import { Plus, Trash2, Pencil, X, Plane, Wallet } from "lucide-react";
import { supabase } from "./lib/supabase";
import "./styles.css";

const CURRENCIES = [
  { code: "CAD", name: "Dollar canadien" },
  { code: "ALL", name: "Lek albanais" },
  { code: "MKD", name: "Denar macédonien" },
  { code: "EUR", name: "Euro" },
];
const DEFAULT_CATS = [
  "Hébergement",
  "Restaurants",
  "Épicerie",
  "Transport",
  "Activités",
  "Magasinage",
  "Alcool",
  "Essence",
  "Frais bancaires",
  "Autre",
];

const money = (n) =>
  new Intl.NumberFormat("fr-CA", {
    style: "currency",
    currency: "CAD",
  }).format(n || 0);

const today = () => new Date().toISOString().slice(0, 10);

function App() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [tripId, setTripId] = useState(null);
  const [participantIds, setParticipantIds] = useState([]);

  const [data, setData] = useState({
    trip: {
      name: "Mon voyage",
      start: "",
      end: "",
      countries: "",
      budget: "",
    },
    people: ["Moi", "Mon conjoint"],
    categories: DEFAULT_CATS,
    expenses: [],
  });

  const [screen, setScreen] = useState("dashboard");
  const [showTrip, setShowTrip] = useState(false);
  const [showExpense, setShowExpense] = useState(false);
  const [editing, setEditing] = useState(null);
  const [rates, setRates] = useState({ CAD: 1 });
  const [rateStatus, setRateStatus] = useState("Prêt");
  const [form, setForm] = useState(null);
  const [joinCode, setJoinCode] = useState("");
  const [showJoin, setShowJoin] = useState(false);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    loadFromSupabase();
  }, []);

  async function joinTripByCode(e) {
    e.preventDefault();

    const code = joinCode.trim().toUpperCase();

    if (!code) {
      setError("Entre le code du voyage.");
      return;
    }

    try {
      setJoining(true);
      setError("");

      const { data: trip, error: tripError } = await supabase
        .from("trips")
        .select("*")
        .eq("share_code", code)
        .single();

      if (tripError || !trip) {
        throw new Error("Code de voyage invalide.");
      }

      localStorage.setItem("voyage-depenses-trip-id", trip.id);

      setShowJoin(false);
      setJoinCode("");

      await loadFromSupabase();
    } catch (err) {
      console.error(err);
      setError(err?.message || "Impossible de rejoindre ce voyage.");
    } finally {
      setJoining(false);
    }
  }

  async function loadFromSupabase() {
    try {
      setLoading(true);
      setError("");

      const savedTripId = localStorage.getItem("voyage-depenses-trip-id");

      let trip = null;

      // Si ce téléphone connaît déjà un voyage,
      // on charge directement celui-ci.
      if (savedTripId) {
        const { data: existingTrip, error: tripError } = await supabase
          .from("trips")
          .select("*")
          .eq("id", savedTripId)
          .single();

        if (tripError) throw tripError;

        trip = existingTrip;
      }

      // Pour compatibilité avec ton installation actuelle :
      // si aucun voyage n'est encore mémorisé, on prend
      // le premier voyage existant.
      if (!trip) {
        const { data: trips, error: tripError } = await supabase
          .from("trips")
          .select("*")
          .order("created_at", { ascending: true })
          .limit(1);

        if (tripError) throw tripError;

        trip = trips?.[0];

        if (!trip) {
          const { data: createdTrip, error: createError } = await supabase
            .from("trips")
            .insert({
              name: "Mon voyage",
              share_code: generateShareCode(),
            })
            .select()
            .single();

          if (createError) throw createError;

          trip = createdTrip;

          const { error: participantError } = await supabase
            .from("participants")
            .insert([
              {
                trip_id: trip.id,
                name: "Moi",
              },
              {
                trip_id: trip.id,
                name: "Mon conjoint",
              },
            ]);

          if (participantError) throw participantError;
        }
      }

      // On mémorise le voyage sur cet appareil.
      localStorage.setItem("voyage-depenses-trip-id", trip.id);

      setTripId(trip.id);

      const [
        { data: participants, error: participantsError },
        { data: expenses, error: expensesError },
      ] = await Promise.all([
        supabase
          .from("participants")
          .select("*")
          .eq("trip_id", trip.id)
          .order("created_at", { ascending: true }),

        supabase
          .from("expenses")
          .select("*")
          .eq("trip_id", trip.id)
          .order("expense_date", { ascending: false }),
      ]);

      if (participantsError) throw participantsError;
      if (expensesError) throw expensesError;

      const people =
        participants?.length > 0
          ? participants.map((p) => p.name)
          : ["Moi", "Mon conjoint"];

      setParticipantIds((participants || []).map((p) => p.id));

      setData({
        trip: {
          name: trip.name || "Mon voyage",
          start: trip.start_date || "",
          end: trip.end_date || "",
          countries: trip.countries || "",
          budget: trip.budget ?? "",
          shareCode: trip.share_code || "",
        },
        people,
        categories: DEFAULT_CATS,
        expenses: (expenses || []).map(dbExpenseToApp),
      });
    } catch (err) {
      console.error(err);
      setError(err?.message || "Impossible de charger les données Supabase.");
    } finally {
      setLoading(false);
    }
  }

  function generateShareCode() {
    return Math.random().toString(36).substring(2, 10).toUpperCase();
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
      description: e.description || "",
      place: e.place || "",
      date: e.expense_date,
      personal: e.personal,
      split: Number(e.split_percentage ?? 50),
    };
  }

  async function saveTrip(e) {
    e.preventDefault();

    if (!tripId) return;

    const person1 = data.people[0]?.trim();
    const person2 = data.people[1]?.trim();

    if (!person1 || !person2) {
      setError("Les deux voyageurs doivent avoir un nom.");
      return;
    }

    if (person1 === person2) {
      setError("Les deux voyageurs doivent avoir des noms différents.");
      return;
    }

    try {
      setSaving(true);
      setError("");

      // Sauvegarde du voyage
      const { error: updateError } = await supabase
        .from("trips")
        .update({
          name: data.trip.name || "Mon voyage",
          start_date: data.trip.start || null,
          end_date: data.trip.end || null,
          countries: data.trip.countries || null,
          budget: data.trip.budget === "" ? null : Number(data.trip.budget),
        })
        .eq("id", tripId);

      if (updateError) throw updateError;

      // Sauvegarde des noms des voyageurs
      for (let i = 0; i < participantIds.length; i++) {
        const participantId = participantIds[i];
        const newName = data.people[i];

        const { error: participantError } = await supabase
          .from("participants")
          .update({
            name: newName,
          })
          .eq("id", participantId);

        if (participantError) throw participantError;
      }

      setShowTrip(false);
    } catch (err) {
      console.error(err);

      setError(err?.message || "Erreur lors de la sauvegarde du voyage.");
    } finally {
      setSaving(false);
    }
  }

  async function getRate(currency) {
    if (currency === "CAD") {
      setRateStatus("1 CAD = 1 CAD");
      return 1;
    }

    try {
      setRateStatus(`Récupération du taux ${currency} → CAD…`);

      const response = await fetch(
        `https://open.er-api.com/v6/latest/${currency}`,
        {
          cache: "no-store",
        },
      );

      if (!response.ok) {
        throw new Error("Erreur du service de taux");
      }

      const json = await response.json();
      const rate = Number(json?.rates?.CAD);

      if (!rate || !Number.isFinite(rate)) {
        throw new Error("Taux CAD introuvable");
      }

      setRates((current) => ({
        ...current,
        [currency]: rate,
      }));

      setRateStatus(`1 ${currency} = ${rate.toFixed(6)} CAD`);

      return rate;
    } catch (error) {
      console.error(error);

      setRateStatus("Taux indisponible");

      return null;
    }
  }

  async function handleCurrencyChange(currency) {
    setForm((current) => ({
      ...current,
      currency,
      rate: currency === "CAD" ? 1 : "",
    }));

    if (currency === "CAD") {
      setRateStatus("1 CAD = 1 CAD");
      return;
    }

    const rate = await getRate(currency);

    if (rate) {
      setForm((current) => ({
        ...current,
        currency,
        rate,
      }));
    }
  }

  async function newExpense() {
    setEditing(null);

    const initialCurrency = "CAD";

    setForm({
      amount: "",
      currency: initialCurrency,
      payer: data.people[0],
      category: data.categories[0],
      description: "",
      date: today(),
      place: "",
      personal: false,
      splitMode: "equal",
      split: 50,
      rate: 1,
    });

    setRateStatus("1 CAD = 1 CAD");
    setShowExpense(true);
  }

  function changeSplitMode(mode) {
    setForm((current) => {
      if (!current) return current;

      switch (mode) {
        case "equal":
          return {
            ...current,
            personal: false,
            splitMode: "equal",
            split: 50,
          };

        case "personal1":
          return {
            ...current,
            personal: false,
            splitMode: "personal1",
            split: 100,
          };

        case "personal2":
          return {
            ...current,
            personal: false,
            splitMode: "personal2",
            split: 0,
          };

        case "custom":
          return {
            ...current,
            personal: false,
            splitMode: "custom",
            split: current.split === 50 ? 50 : current.split,
          };

        default:
          return current;
      }
    });
  }

  async function saveExpense(e) {
    e.preventDefault();

    if (!tripId) return;

    const amount = Number(form.amount);

    if (!amount) return;

    try {
      setSaving(true);
      setError("");

      const rate = form.currency === "CAD" ? 1 : await getRate(form.currency);

      if (!rate) {
        setError(`Impossible de récupérer le taux ${form.currency} → CAD.`);
        return;
      }

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
        split_percentage: form.split,
      };

      if (editing) {
        const { data: updated, error: updateError } = await supabase
          .from("expenses")
          .update(payload)
          .eq("id", editing.id)
          .select()
          .single();

        if (updateError) throw updateError;

        setData((current) => ({
          ...current,
          expenses: current.expenses.map((expense) =>
            expense.id === editing.id ? dbExpenseToApp(updated) : expense,
          ),
        }));
      } else {
        const { data: created, error: insertError } = await supabase
          .from("expenses")
          .insert(payload)
          .select()
          .single();

        if (insertError) throw insertError;

        setData((current) => ({
          ...current,
          expenses: [dbExpenseToApp(created), ...current.expenses],
        }));
      }

      setShowExpense(false);
      setForm(null);
      setEditing(null);
    } catch (err) {
      console.error(err);
      setError(err?.message || "Impossible de sauvegarder la dépense.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteExpense(id) {
    if (!confirm("Supprimer cette dépense ?")) return;

    try {
      setSaving(true);
      setError("");

      const { error: deleteError } = await supabase
        .from("expenses")
        .delete()
        .eq("id", id);

      if (deleteError) throw deleteError;

      setData((current) => ({
        ...current,
        expenses: current.expenses.filter((expense) => expense.id !== id),
      }));
    } catch (err) {
      console.error(err);
      setError(err?.message || "Impossible de supprimer la dépense.");
    } finally {
      setSaving(false);
    }
  }

  function editExpense(expense) {
    let splitMode = "custom";

    if (expense.split === 50) {
      splitMode = "equal";
    } else if (expense.split === 100) {
      splitMode = expense.payer === data.people[0] ? "personal1" : "personal2";
    } else if (expense.split === 0) {
      splitMode = expense.payer === data.people[0] ? "personal2" : "personal1";
    }

    setEditing(expense);

    setForm({
      ...expense,
      splitMode,
      rate: expense.currency === "CAD" ? "" : expense.rate,
    });

    setShowExpense(true);
  }

  const stats = useMemo(() => {
    const total = data.expenses.reduce((sum, expense) => sum + expense.cad, 0);

    const personal = data.expenses.filter((expense) => expense.personal);

    const shared = data.expenses.filter((expense) => !expense.personal);

    const paid = Object.fromEntries(
      data.people.map((person) => [
        person,
        data.expenses
          .filter((expense) => expense.payer === person)
          .reduce((sum, expense) => sum + expense.cad, 0),
      ]),
    );

    const owedBy = Object.fromEntries(data.people.map((person) => [person, 0]));

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
      sharedTotal: shared.reduce((sum, expense) => sum + expense.cad, 0),
      personalTotal: personal.reduce((sum, expense) => sum + expense.cad, 0),
      paid,
      net,
      budget,
      remaining: budget - total,
    };
  }, [data]);

  if (loading) {
    return (
      <div className="app">
        <main>
          <div className="empty">Chargement de ton voyage…</div>
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

        <div style={{ display: "flex", gap: "8px" }}>
          <button
            className="iconBtn"
            onClick={() => setShowTrip(true)}
            title="Voyage"
          >
            <Wallet size={20} />
          </button>

          <button
            className="iconBtn"
            onClick={() => setShowJoin(true)}
            title="Rejoindre un voyage"
          >
            <Plus size={20} />
          </button>
        </div>
      </header>

      {showJoin && (
        <Modal
          title="Rejoindre un voyage"
          close={() => {
            setShowJoin(false);
            setJoinCode("");
          }}
        >
          <form className="form" onSubmit={joinTripByCode}>
            <p>Entre le code de partage que ton compagnon t'a donné.</p>

            <label>
              Code du voyage
              <input
                autoFocus
                required
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck="false"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="Ex. 4251CBDD"
              />
            </label>

            <button className="primary" disabled={joining}>
              {joining ? "Connexion…" : "Rejoindre le voyage"}
            </button>
          </form>
        </Modal>
      )}

      {error && <div className="error">{error}</div>}

      {saving && <div className="saving">Sauvegarde…</div>}

      <main>
        {screen === "dashboard" && (
          <Dashboard
            data={data}
            stats={stats}
            onAdd={newExpense}
            onHistory={() => setScreen("history")}
            onTrip={() => setShowTrip(true)}
          />
        )}

        {screen === "history" && (
          <History
            data={data}
            onBack={() => setScreen("dashboard")}
            onEdit={editExpense}
            onDelete={deleteExpense}
          />
        )}
      </main>

      <nav>
        <button
          className={screen === "dashboard" ? "active" : ""}
          onClick={() => setScreen("dashboard")}
        >
          Tableau de bord
        </button>

        <button
          className={screen === "history" ? "active" : ""}
          onClick={() => setScreen("history")}
        >
          Dépenses
        </button>

        <button className="add" onClick={newExpense}>
          <Plus />
        </button>
      </nav>

      {showTrip && (
        <Modal title="Mon voyage" close={() => setShowTrip(false)}>
          <form onSubmit={saveTrip} className="form">
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
                      name: e.target.value,
                    },
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
                      start: e.target.value,
                    },
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
                      end: e.target.value,
                    },
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
                      countries: e.target.value,
                    },
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
                      budget: e.target.value,
                    },
                  }))
                }
              />
            </label>
            <div className="travellers">
              <h3>Voyageurs</h3>

              {data.people.map((person, index) => (
                <label key={participantIds[index] || index}>
                  Voyageur {index + 1}
                  <input
                    type="text"
                    value={person}
                    maxLength={40}
                    onChange={(e) =>
                      setData((current) => ({
                        ...current,
                        people: current.people.map((p, i) =>
                          i === index ? e.target.value : p,
                        ),
                      }))
                    }
                  />
                </label>
              ))}
            </div>
            <button className="primary" disabled={saving}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </form>
        </Modal>
      )}
      {showExpense && form && (
        <Modal
          title={editing ? "Modifier la dépense" : "Ajouter une dépense"}
          close={() => setShowExpense(false)}
        >
          <form onSubmit={saveExpense} className="form">
            {/* MONTANT */}
            <label>
              Montant
              <input
                autoFocus
                required
                type="number"
                step="0.01"
                min="0"
                value={form.amount}
                onChange={(e) =>
                  setForm({
                    ...form,
                    amount: e.target.value,
                  })
                }
              />
            </label>

            {/* CONVERSION CAD EN TEMPS RÉEL */}
            {form.amount && Number(form.amount) > 0 && (
              <div className="liveConversion">
                <div className="liveConversionLabel">Équivalent en CAD</div>

                <div className="liveConversionAmount">
                  {form.currency === "CAD"
                    ? money(Number(form.amount))
                    : form.rate
                      ? money(Number(form.amount) * Number(form.rate))
                      : "Mise à jour du taux…"}
                </div>

                {form.currency !== "CAD" && form.rate && (
                  <div className="liveConversionRate">
                    Taux actuel : 1 {form.currency} ={" "}
                    {Number(form.rate).toFixed(6)} CAD
                  </div>
                )}
              </div>
            )}

            {/* DEVISE + PAYEUR */}
            <div className="grid2">
              <label>
                Devise
                <select
                  value={form.currency}
                  onChange={(e) => handleCurrencyChange(e.target.value)}
                >
                  {CURRENCIES.map((currency) => (
                    <option key={currency.code} value={currency.code}>
                      {currency.code} — {currency.name}
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
                      payer: e.target.value,
                    })
                  }
                >
                  {data.people.map((person) => (
                    <option key={person} value={person}>
                      {person}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* CATÉGORIE + DATE */}
            <div className="grid2">
              <label>
                Catégorie
                <select
                  value={form.category}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      category: e.target.value,
                    })
                  }
                >
                  {data.categories.map((category) => (
                    <option key={category} value={category}>
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
                      date: e.target.value,
                    })
                  }
                />
              </label>
            </div>

            {/* DESCRIPTION */}
            <label>
              Description (facultatif)
              <input
                value={form.description}
                onChange={(e) =>
                  setForm({
                    ...form,
                    description: e.target.value,
                  })
                }
              />
            </label>

            {/* LIEU */}
            <label>
              Lieu (facultatif)
              <input
                value={form.place}
                onChange={(e) =>
                  setForm({
                    ...form,
                    place: e.target.value,
                  })
                }
              />
            </label>

            {/* RÉPARTITION */}
            {data.people.length >= 2 && (
              <div className="splitSection">
                <div className="splitTitle">Répartition</div>

                <div className="splitOptions">
                  <button
                    type="button"
                    className={
                      form.splitMode === "equal"
                        ? "splitOption active"
                        : "splitOption"
                    }
                    onClick={() => changeSplitMode("equal")}
                  >
                    <span className="radio">
                      {form.splitMode === "equal" ? "●" : "○"}
                    </span>

                    <span>
                      <b>50 / 50</b>
                      <small>
                        {data.people[0]} et {data.people[1]}
                      </small>
                    </span>
                  </button>

                  <button
                    type="button"
                    className={
                      form.splitMode === "personal1"
                        ? "splitOption active"
                        : "splitOption"
                    }
                    onClick={() => changeSplitMode("personal1")}
                  >
                    <span className="radio">
                      {form.splitMode === "personal1" ? "●" : "○"}
                    </span>

                    <span>
                      <b>{data.people[0]} seulement</b>
                      <small>100 % {data.people[0]}</small>
                    </span>
                  </button>

                  <button
                    type="button"
                    className={
                      form.splitMode === "personal2"
                        ? "splitOption active"
                        : "splitOption"
                    }
                    onClick={() => changeSplitMode("personal2")}
                  >
                    <span className="radio">
                      {form.splitMode === "personal2" ? "●" : "○"}
                    </span>

                    <span>
                      <b>{data.people[1]} seulement</b>
                      <small>100 % {data.people[1]}</small>
                    </span>
                  </button>

                  <button
                    type="button"
                    className={
                      form.splitMode === "custom"
                        ? "splitOption active"
                        : "splitOption"
                    }
                    onClick={() => changeSplitMode("custom")}
                  >
                    <span className="radio">
                      {form.splitMode === "custom" ? "●" : "○"}
                    </span>

                    <span>
                      <b>Personnalisé</b>
                      <small>Choisir les proportions</small>
                    </span>
                  </button>
                </div>

                {form.splitMode === "custom" && (
                  <div className="customSplit">
                    <div className="splitPercent">
                      <span>{data.people[0]}</span>
                      <b>{form.split}%</b>
                    </div>

                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={form.split}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          split: Number(e.target.value),
                        })
                      }
                    />

                    <div className="splitPercent">
                      <span>{data.people[1]}</span>
                      <b>{100 - form.split}%</b>
                    </div>
                  </div>
                )}

                <div className="splitAmounts">
                  <div>
                    <span>{data.people[0]}</span>

                    <b>
                      {money(
                        (Number(form.amount) || 0) *
                          (form.split / 100) *
                          (form.currency === "CAD"
                            ? 1
                            : Number(form.rate) || 0),
                      )}
                    </b>
                  </div>

                  <div>
                    <span>{data.people[1]}</span>

                    <b>
                      {money(
                        (Number(form.amount) || 0) *
                          ((100 - form.split) / 100) *
                          (form.currency === "CAD"
                            ? 1
                            : Number(form.rate) || 0),
                      )}
                    </b>
                  </div>
                </div>
              </div>
            )}

            {/* TAUX */}
            {form.currency !== "CAD" && form.rate && (
              <div className="rate">
                Taux actuel : 1 {form.currency} = {Number(form.rate).toFixed(6)}{" "}
                CAD
              </div>
            )}

            {/* STATUT DU TAUX */}
            <div className="rate">{rateStatus}</div>

            {/* SAVE */}
            <button className="primary" disabled={saving}>
              {saving ? "Enregistrement…" : "Enregistrer la dépense"}
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}

function Dashboard({ data, stats, onAdd, onHistory, onTrip }) {
  const pct = stats.budget
    ? Math.min(100, Math.max(0, (stats.total / stats.budget) * 100))
    : 0;

  const debtor = stats.net > 0 ? data.people[1] : data.people[0];

  const creditor = stats.net > 0 ? data.people[0] : data.people[1];

  const categories = Object.entries(
    data.expenses.reduce((result, expense) => {
      const category = expense.category || "Autre";

      result[category] = (result[category] || 0) + expense.cad;

      return result;
    }, {}),
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  const categoryTotal = categories.reduce((sum, [, amount]) => sum + amount, 0);

  const maxCategory = categories.length > 0 ? categories[0][1] : 0;

  return (
    <section>
      {/* VOYAGE */}
      <div className="hero">
        <div>
          <p className="eyebrow">
            {data.trip.start && data.trip.end
              ? `${data.trip.start} → ${data.trip.end}`
              : "Nouveau voyage"}
          </p>

          <h1>{data.trip.name}</h1>

          <p>{data.trip.countries || "Configure ton voyage pour commencer."}</p>
        </div>

        <button onClick={onTrip}>Modifier</button>
      </div>

      {/* RÉSUMÉ */}
      <div className="dashboardSummary">
        <div className="summaryCard primarySummary">
          <span>Total dépensé</span>
          <strong>{money(stats.total)}</strong>

          <small>
            {stats.sharedTotal > 0
              ? `${money(stats.sharedTotal)} partagé`
              : "Aucune dépense partagée"}
          </small>
        </div>

        <div className="summaryCard">
          <span>Budget</span>

          <strong>{stats.budget ? money(stats.budget) : "—"}</strong>

          {stats.budget > 0 && (
            <small>{money(Math.max(0, stats.remaining))} restant</small>
          )}
        </div>
      </div>

      {/* PROGRESSION BUDGET */}
      {stats.budget > 0 && (
        <div className="budget budgetEnhanced">
          <div className="budgetHeader">
            <div>
              <span>Budget utilisé</span>
              <strong>{pct.toFixed(1)} %</strong>
            </div>

            <span>{money(stats.remaining)} restant</span>
          </div>

          <div className="bar">
            <i
              style={{
                width: `${pct}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* SOLDE */}
      <div className="balance balanceEnhanced">
        <div className="balanceTitle">
          <span>Solde entre vous</span>
          <span className="balanceIcon">⚖️</span>
        </div>

        <strong>
          {data.people.length < 2
            ? "Ajoute un deuxième voyageur"
            : Math.abs(stats.net) < 0.005
              ? "Vous êtes à égalité"
              : `${debtor} doit ${money(Math.abs(stats.net))} à ${creditor}`}
        </strong>
      </div>

      {/* CATÉGORIES */}
      {categories.length > 0 && (
        <div className="categoryCard">
          <div className="sectionTitle">
            <div>
              <span>Dépenses par catégorie</span>
              <small>{money(categoryTotal)} au total</small>
            </div>
          </div>

          <div className="categoryList">
            {categories.map(([category, amount]) => {
              const percentage =
                stats.total > 0 ? (amount / stats.total) * 100 : 0;

              const relativeWidth =
                maxCategory > 0 ? (amount / maxCategory) * 100 : 0;

              return (
                <div className="categoryRow" key={category}>
                  <div className="categoryTop">
                    <span>{category}</span>

                    <div>
                      <b>{money(amount)}</b>

                      <small>{percentage.toFixed(0)}%</small>
                    </div>
                  </div>

                  <div className="categoryBar">
                    <i
                      style={{
                        width: `${relativeWidth}%`,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* RÉPARTITION PAR VOYAGEUR */}
      <div className="people peopleEnhanced">
        <div className="sectionTitle">
          <div>
            <span>Dépenses par voyageur</span>
            <small>Montant payé</small>
          </div>
        </div>

        {data.people.map((person) => (
          <div key={person} className="personRow">
            <div className="personInfo">
              <div className="avatar">{person.charAt(0).toUpperCase()}</div>

              <span>{person}</span>
            </div>

            <b>{money(stats.paid[person])}</b>
          </div>
        ))}
      </div>

      {/* ACTIONS */}
      <button className="primary big" onClick={onAdd}>
        <Plus />
        Ajouter une dépense
      </button>

      <button className="secondary big" onClick={onHistory}>
        Voir l'historique ({data.expenses.length})
      </button>
    </section>
  );
}

function History({ data, onBack, onEdit, onDelete }) {
  return (
    <section>
      <div className="topline">
        <button onClick={onBack}>← Retour</button>

        <h2>Dépenses</h2>
      </div>

      {data.expenses.length === 0 ? (
        <div className="empty">Aucune dépense pour le moment.</div>
      ) : (
        <div className="list">
          {data.expenses.map((expense) => (
            <div className="expense" key={expense.id}>
              <div>
                <b>{expense.description || expense.category}</b>

                <small>
                  {expense.date} · {expense.payer} ·{" "}
                  {expense.personal ? "Personnel" : "Partagé"}
                </small>

                <small>
                  {expense.amount.toFixed(2)} {expense.currency} →{" "}
                  {money(expense.cad)}
                </small>
              </div>

              <div className="actions">
                <button onClick={() => onEdit(expense)}>
                  <Pencil size={17} />
                </button>

                <button onClick={() => onDelete(expense.id)}>
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

export default App;
