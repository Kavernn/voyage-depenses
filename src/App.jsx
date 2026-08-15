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
  const [syncStatus, setSyncStatus] = useState("connecting");

  useEffect(() => {
    loadFromSupabase();
  }, []);


  useEffect(() => {
    if (!tripId) return;

    const channel = supabase
      .channel(`voyage-${tripId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "expenses",
          filter: `trip_id=eq.${tripId}`,
        },
        () => {
          loadFromSupabase();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "participants",
          filter: `trip_id=eq.${tripId}`,
        },
        () => {
          loadFromSupabase();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "trips",
          filter: `id=eq.${tripId}`,
        },
        () => {
          loadFromSupabase();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tripId]);

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

      const params = new URLSearchParams(window.location.search);
      const shareCodeFromUrl = params.get("trip")?.trim().toUpperCase();

      let trip = null;

      // 1. Si un code de partage est présent dans l'URL,
      // on charge précisément ce voyage.
      if (shareCodeFromUrl) {
        const { data: sharedTrip, error: sharedTripError } = await supabase
          .from("trips")
          .select("*")
          .eq("share_code", shareCodeFromUrl)
          .maybeSingle();

        if (sharedTripError) throw sharedTripError;

        if (!sharedTrip) {
          throw new Error(
            "Ce lien de voyage est invalide ou le voyage n'existe plus.",
          );
        }

        trip = sharedTrip;

        // On mémorise le voyage pour les prochaines ouvertures.
        localStorage.setItem("voyage-depenses-trip-id", trip.id);
        localStorage.setItem(
          "voyage-depenses-share-code",
          trip.share_code,
        );

        // Nettoie l'URL après chargement.
        window.history.replaceState({}, "", "/");
      }

      // 2. Sinon, on reprend le dernier voyage utilisé.
      if (!trip) {
        const savedTripId = localStorage.getItem(
          "voyage-depenses-trip-id",
        );

        if (savedTripId) {
          const { data: savedTrip, error: savedTripError } = await supabase
            .from("trips")
            .select("*")
            .eq("id", savedTripId)
            .maybeSingle();

          if (savedTripError) throw savedTripError;

          trip = savedTrip;
        }
      }

      // 3. Dernier fallback : premier voyage existant.
      if (!trip) {
        const { data: trips, error: tripError } = await supabase
          .from("trips")
          .select("*")
          .order("created_at", { ascending: true })
          .limit(1);

        if (tripError) throw tripError;

        trip = trips?.[0];
      }

      // 4. Si aucun voyage n'existe, on en crée un.
      if (!trip) {
        const { data: createdTrip, error: createError } = await supabase
          .from("trips")
          .insert({
            name: "Mon voyage",
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

      setTripId(trip.id);

      localStorage.setItem(
        "voyage-depenses-trip-id",
        trip.id,
      );

      if (trip.share_code) {
        localStorage.setItem(
          "voyage-depenses-share-code",
          trip.share_code,
        );
      }

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
          shareCode: trip.share_code || "",
          start: trip.start_date || "",
          end: trip.end_date || "",
          countries: trip.countries || "",
          budget: trip.budget ?? "",
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
                type="text"
                inputMode="text"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck="false"
                maxLength={8}
                value={joinCode}
                placeholder="Ex. 4251CBDD"
                onChange={(e) =>
                  setJoinCode(e.target.value.toUpperCase())
                }
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

      <nav className="bottomNav">
  <button
    className={screen === "dashboard" ? "active" : ""}
    onClick={() => setScreen("dashboard")}
  >
    <span>Accueil</span>
  </button>

  <button className="add" onClick={newExpense} aria-label="Ajouter une dépense">
    <Plus size={24} />
  </button>

  <button
    className={screen === "history" ? "active" : ""}
    onClick={() => setScreen("history")}
  >
    <span>Dépenses</span>
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
                <div className="expenseAmountSection">
              <label className="amountLabel">
                Montant
              </label>

              <div className="amountInputWrap">
                <input
                  className="amountInput"
                  autoFocus
                  required
                  type="number"
                  inputMode="decimal"
                  enterKeyHint="next"
                  step="0.01"
                  min="0"
                  value={form.amount}
                  placeholder="0,00"
                  onChange={(e) =>
                    setForm({
                      ...form,
                      amount: e.target.value,
                    })
                  }
                />

                <span className="amountCurrency">
                  {form.currency}
                </span>
              </div>
            </div>

            {/* CONVERSION CAD EN TEMPS RÉEL */}
            {form.amount && Number(form.amount) > 0 && (
              <div className="liveConversion mobileLiveConversion">
                <div className="liveConversionMain">
                  <span>≈</span>

                  <strong>
                    {form.currency === "CAD"
                      ? money(Number(form.amount))
                      : form.rate
                        ? money(
                            Number(form.amount) * Number(form.rate),
                          )
                        : "…"}
                  </strong>

                  <span>CAD</span>
                </div>

                {form.currency !== "CAD" && form.rate && (
                  <div className="liveConversionRate">
                    1 {form.currency} ={" "}
                    {Number(form.rate).toFixed(6)} CAD
                  </div>
                )}
              </div>
            )}

         {/* DEVISE */}
<div className="expenseChoiceSection">
  <label>Devise</label>

  <div className="currencyGrid">
    {CURRENCIES.map((currency) => (
      <button
        key={currency.code}
        type="button"
        className={
          form.currency === currency.code
            ? "currencyChoice active"
            : "currencyChoice"
        }
        onClick={() => handleCurrencyChange(currency.code)}
      >
        <strong>{currency.code}</strong>
        <span>{currency.name}</span>
      </button>
    ))}
  </div>
</div>

{/* PAYEUR */}
<div className="expenseChoiceSection">
  <label>Payé par</label>

  <div className="payerGrid">
    {data.people.map((person) => (
      <button
        key={person}
        type="button"
        className={
          form.payer === person
            ? "payerChoice active"
            : "payerChoice"
        }
        onClick={() =>
          setForm({
            ...form,
            payer: person,
          })
        }
      >
        <span className="payerAvatar">
          {person.charAt(0).toUpperCase()}
        </span>

        <span>{person}</span>
      </button>
    ))}
  </div>
</div>

  {/* CATÉGORIES */}
{categories.length > 0 && (
  <div className="categoryCard mobileCategoryCard">
    <div className="categoryHeader">
      <div>
        <span className="sectionEyebrow">ANALYSE</span>
        <h3>Dépenses par catégorie</h3>
      </div>

      <div className="categoryTotal">
        <strong>{money(categoryTotal)}</strong>
        <span>au total</span>
      </div>
    </div>

    <div className="categoryList">
      {categories.map(([category, amount]) => {
        const percentage =
          categoryTotal > 0
            ? (amount / categoryTotal) * 100
            : 0;

        const relativeWidth =
          maxCategory > 0
            ? (amount / maxCategory) * 100
            : 0;

        const icons = {
          Hébergement: "🏨",
          Restaurants: "🍽️",
          Épicerie: "🛒",
          Transport: "🚗",
          Activités: "🎟️",
          Magasinage: "🛍️",
          Alcool: "🍷",
          Essence: "⛽",
          "Frais bancaires": "💳",
          Autre: "📦",
        };

        return (
          <div
            className="categoryRow mobileCategoryRow"
            key={category}
          >
            <div className="categoryRowTop">
              <div className="categoryName">
                <span className="categoryIcon">
                  {icons[category] || "📦"}
                </span>

                <div>
                  <strong>{category}</strong>
                  <small>
                    {percentage.toFixed(0)}% du total
                  </small>
                </div>
              </div>

              <strong className="categoryAmount">
                {money(amount)}
              </strong>
            </div>

            <div className="categoryBar">
              <span
                style={{
                  width: `${Math.max(relativeWidth, 2)}%`,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  </div>
)}

{/* DATE */}
<div className="expenseDateSection">
  <label htmlFor="expense-date">Date</label>

  <input
    id="expense-date"
    className="expenseDateInput"
    type="date"
    value={form.date}
    onChange={(e) =>
      setForm({
        ...form,
        date: e.target.value,
      })
    }
  />
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
            ### Section Répartition corrigée

```jsx
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

  const isBalanced =
    data.people.length < 2 || Math.abs(stats.net) < 0.005;

  const categories = Object.entries(
    data.expenses.reduce((result, expense) => {
      const category = expense.category || "Autre";

      result[category] = (result[category] || 0) + expense.cad;

      return result;
    }, {}),
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  const categoryTotal = categories.reduce(
    (sum, [, amount]) => sum + amount,
    0,
  );

  const maxCategory = categories.length > 0 ? categories[0][1] : 0;

  const tripDays = (() => {
    if (!data.trip.start || !data.trip.end) return null;
  
    const start = new Date(data.trip.start);
    const end = new Date(data.trip.end);
  
    const diff = Math.ceil(
      (end - start) / (1000 * 60 * 60 * 24),
    );
  
    return Math.max(1, diff + 1);
  })();
  
  const dailyAverage =
    tripDays && stats.total > 0
      ? stats.total / tripDays
      : 0;
  
  const budgetRemaining =
    stats.budget > 0
      ? stats.remaining
      : null;

  return (
    <section className="dashboard">
     {/* HEADER VOYAGE */}
<div className="travelHero">
  <div className="travelHeroTop">
    <div className="travelHeroIcon">
      <Plane size={22} />
    </div>

    <button
      className="travelHeroEdit"
      onClick={onTrip}
      aria-label="Modifier le voyage"
    >
      <Pencil size={17} />
    </button>
  </div>

  <div className="travelHeroContent">
    <span className="travelHeroLabel">
      {data.trip.start && data.trip.end
        ? `${data.trip.start} → ${data.trip.end}`
        : "NOUVEAU VOYAGE"}
    </span>

    <h1>{data.trip.name}</h1>

    <p>
      {data.trip.countries ||
        "Ajoute les destinations de ton voyage"}
    </p>
  </div>

  <div className="travelHeroStats">
    {tripDays && (
      <div>
        <strong>{tripDays}</strong>
        <span>jours</span>
      </div>
    )}

    {stats.total > 0 && (
      <div>
        <strong>{money(dailyAverage)}</strong>
        <span>/ jour</span>
      </div>
    )}

    {data.people.length > 0 && (
      <div>
        <strong>{data.people.length}</strong>
        <span>voyageurs</span>
      </div>
    )}
  </div>
</div>

      {/* RÉSUMÉ FINANCIER */}
      <div className="financialGrid">
        <div className="financialCard financialCardMain">
          <div className="financialCardLabel">
            <span>Total dépensé</span>
            <Wallet size={17} />
          </div>

          <strong>{money(stats.total)}</strong>

          <small>
            {stats.sharedTotal > 0
              ? `${money(stats.sharedTotal)} partagé`
              : "Aucune dépense partagée"}
          </small>
        </div>

        <div className="financialCard">
          <div className="financialCardLabel">
            <span>Budget</span>
          </div>

          <strong>
            {stats.budget ? money(stats.budget) : "—"}
          </strong>

          <small>
            {stats.budget > 0
              ? stats.remaining >= 0
                ? `${money(stats.remaining)} restant`
                : `${money(Math.abs(stats.remaining))} dépassé`
              : "Aucun budget défini"}
          </small>
        </div>
      </div>

      {/* PROGRESSION BUDGET */}
      {stats.budget > 0 && (
        <div className="budget budgetEnhanced mobileBudget">
          <div className="budgetHeader">
            <div>
              <span>Budget utilisé</span>
              <strong>{pct.toFixed(0)} %</strong>
            </div>

            <span>
              {stats.remaining >= 0
                ? `${money(stats.remaining)} restant`
                : `${money(Math.abs(stats.remaining))} dépassé`}
            </span>
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
      <div
        className={`balance balanceEnhanced mobileBalance ${
          isBalanced ? "balanced" : ""
        }`}
      >
        <div className="balanceTitle">
          <span>Solde entre vous</span>
          <span className="balanceIcon">⚖️</span>
        </div>

        {data.people.length < 2 ? (
          <strong>Ajoute un deuxième voyageur</strong>
        ) : isBalanced ? (
          <>
            <strong>Vous êtes à égalité</strong>
            <small>Tout est équilibré pour le moment</small>
          </>
        ) : (
          <>
            <strong>
              {debtor} doit {money(Math.abs(stats.net))}
            </strong>

            <small>à {creditor}</small>
          </>
        )}
      </div>

      {/* DÉPENSES PAR CATÉGORIE */}
      {categories.length > 0 && (
        <div className="categoryCard mobileCategoryCard">
          <div className="categoryHeader">
            <div>
              <span>Dépenses par catégorie</span>
              <small>{money(categoryTotal)} au total</small>
            </div>

            <div className="categoryCount">
              {categories.length}
            </div>
          </div>

          <div className="categoryList">
            {categories.map(([category, amount], index) => {
              const percentage =
                stats.total > 0
                  ? (amount / stats.total) * 100
                  : 0;

              const relativeWidth =
                maxCategory > 0
                  ? (amount / maxCategory) * 100
                  : 0;

              return (
                <div
                  className="categoryRow mobileCategoryRow"
                  key={category}
                >
                  <div className="categoryTop">
                    <div className="categoryName">
                      <span className={`categoryDot categoryDot${index}`} />
                      <span>{category}</span>
                    </div>

                    <div className="categoryAmount">
                      <strong>{money(amount)}</strong>
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
      <div className="people peopleEnhanced mobilePeople">
        <div className="peopleHeader">
          <div>
            <span>Dépenses par voyageur</span>
            <small>Montant payé par chacun</small>
          </div>

          <div className="peopleCount">
            {data.people.length}
          </div>
        </div>

        <div className="peopleList">
          {data.people.map((person) => {
            const paid = stats.paid[person] || 0;
            const percentage =
              stats.total > 0
                ? (paid / stats.total) * 100
                : 0;

            return (
              <div key={person} className="personRow mobilePersonRow">
                <div className="personInfo">
                  <div className="avatar">
                    {person.charAt(0).toUpperCase()}
                  </div>

                  <div className="personName">
                    <span>{person}</span>
                    <small>
                      {percentage.toFixed(0)} % du total
                    </small>
                  </div>
                </div>

                <div className="personAmount">
                  <strong>{money(paid)}</strong>
                  <div className="personBar">
                    <i
                      style={{
                        width: `${Math.min(100, percentage)}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

           {/* ACTIONS */}
           <div className="dashboardActions">
        <button className="primary big mobileAddButton" onClick={onAdd}>
          <Plus size={21} />
          <span>Ajouter une dépense</span>
        </button>

        <button className="secondary big mobileHistoryButton" onClick={onHistory}>
          <span>Voir l'historique</span>
          <span className="historyCount">{data.expenses.length}</span>
        </button>
      </div>
    </section>
  );
}

function History({ data, onBack, onEdit, onDelete }) {
  return (
    <section className="historyScreen">
      <div className="historyHeader">
        <button className="historyBack" onClick={onBack}>
          ←
        </button>

        <div>
          <span>DÉPENSES</span>
          <h2>Historique</h2>
        </div>

        <div className="historyTotal">
          <strong>{data.expenses.length}</strong>
          <small>dépenses</small>
        </div>
      </div>

      {data.expenses.length === 0 ? (
        <div className="historyEmpty">
          <div className="historyEmptyIcon">
            <Wallet size={24} />
          </div>

          <strong>Aucune dépense</strong>

          <p>
            Tes dépenses apparaîtront ici dès que tu en ajouteras une.
          </p>
        </div>
      ) : (
        <div className="historyList">
          {data.expenses.map((expense) => {
            const category = expense.category || "Autre";
            const initial = category.charAt(0).toUpperCase();

            return (
              <article className="expenseCard" key={expense.id}>
                <div className="expenseCardMain">
                  <div className="expenseCategoryIcon">
                    {initial}
                  </div>

                  <div className="expenseCardInfo">
                    <div className="expenseCardTitle">
                      <strong>
                        {expense.description || category}
                      </strong>

                      <span
                        className={
                          expense.personal
                            ? "expenseBadge personal"
                            : "expenseBadge shared"
                        }
                      >
                        {expense.personal ? "Personnel" : "Partagé"}
                      </span>
                    </div>

                    <div className="expenseMeta">
                      <span>{category}</span>
                      <span>•</span>
                      <span>{expense.payer}</span>
                      <span>•</span>
                      <span>{expense.date}</span>
                    </div>

                    <small className="expenseOriginal">
                      {Number(expense.amount).toFixed(2)}{" "}
                      {expense.currency}
                    </small>
                  </div>

                  <div className="expenseCardAmount">
                    <strong>{money(expense.cad)}</strong>
                  </div>
                </div>

                <div className="expenseCardActions">
                  <button
                    type="button"
                    onClick={() => onEdit(expense)}
                    aria-label={`Modifier ${expense.description || category}`}
                  >
                    <Pencil size={16} />
                    <span>Modifier</span>
                  </button>

                  <button
                    type="button"
                    className="deleteAction"
                    onClick={() => onDelete(expense.id)}
                    aria-label={`Supprimer ${expense.description || category}`}
                  >
                    <Trash2 size={16} />
                    <span>Supprimer</span>
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default App;
