import React, { useEffect, useMemo, useState } from "react";
import Modal from "./components/Modal";
import {
  Plus,
  Trash2,
  Pencil,
  X,
  Plane,
  Wallet,
  House,
  ReceiptText,
  ArrowLeft,
} from "lucide-react";
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

function sortExpenses(expenses) {
  return [...expenses].sort((a, b) => {
    const dateA = String(a?.date || "");
    const dateB = String(b?.date || "");

    if (dateA !== dateB) {
      return dateB.localeCompare(dateA);
    }

    // Si deux dépenses ont la même date, on garde un ordre stable
    // basé sur l'id pour éviter les changements visuels aléatoires.
    return String(b?.id || "").localeCompare(String(a?.id || ""));
  });
}

function parseAmountInput(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  const normalized = String(value ?? "")
    .trim()
    .replace(",", ".");

  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : 0;
}

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
  const [tripEditSnapshot, setTripEditSnapshot] = useState(null);
  const [showExpense, setShowExpense] = useState(false);
  const [editing, setEditing] = useState(null);
  const [rates, setRates] = useState({ CAD: 1 });
  const [rateStatus, setRateStatus] = useState("Prêt");
  const [form, setForm] = useState(null);
  const [joinCode, setJoinCode] = useState("");
  const [showJoin, setShowJoin] = useState(false);
  const [joining, setJoining] = useState(false);
  const [syncStatus, setSyncStatus] = useState("connecting");
  const [tripDestinationDraft, setTripDestinationDraft] = useState("");

  /*
   * Helpers propres à l'éditeur du voyage.
   * Le Dashboard possède ses propres calculs, mais le modal
   * est rendu dans App() et ne peut pas accéder à ceux-ci.
   */
  const tripEditorDays = (() => {
    if (!data.trip.start || !data.trip.end) return null;

    const start = new Date(`${data.trip.start}T00:00:00`);
    const end = new Date(`${data.trip.end}T00:00:00`);

    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      end < start
    ) {
      return null;
    }

    const diff = Math.floor(
      (end - start) / (1000 * 60 * 60 * 24),
    );

    return diff + 1;
  })();

  const tripEditorFormatDate = (value) => {
    if (!value) return "—";

    const date = new Date(`${value}T00:00:00`);

    if (Number.isNaN(date.getTime())) return "—";

    return new Intl.DateTimeFormat("fr-CA", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(date);
  };

  const tripEditorCompactMoney = (value) => {
    const amount = Number(value);

    if (!Number.isFinite(amount)) return "—";

    return `${new Intl.NumberFormat("fr-CA", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount)} $`;
  };
  const [noTrip, setNoTrip] = useState(false);
  const [creatingTrip, setCreatingTrip] = useState(false);

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
        (payload) => {
          setData((current) => {
            if (payload.eventType === "DELETE") {
              const deletedId = payload.old?.id;

              if (!deletedId) return current;

              return {
                ...current,
                expenses: current.expenses.filter(
                  (expense) => expense.id !== deletedId,
                ),
              };
            }

            if (
              payload.eventType === "INSERT" ||
              payload.eventType === "UPDATE"
            ) {
              if (!payload.new?.id) return current;

              const incoming = dbExpenseToApp(payload.new);

              const alreadyExists = current.expenses.some(
                (expense) => expense.id === incoming.id,
              );

              return {
                ...current,
                expenses: sortExpenses(
                  alreadyExists
                    ? current.expenses.map((expense) =>
                        expense.id === incoming.id ? incoming : expense,
                      )
                    : [incoming, ...current.expenses],
                ),
              };
            }

            return current;
          });
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
          loadFromSupabase(tripId);
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
          loadFromSupabase(tripId);
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

      // Charge explicitement le voyage rejoint.
      // On ne dépend pas d'un fallback ou d'un état React asynchrone.
      await loadFromSupabase(trip.id);
    } catch (err) {
      console.error(err);
      setError(err?.message || "Impossible de rejoindre ce voyage.");
    } finally {
      setJoining(false);
    }
  }

  async function loadFromSupabase(preferredTripId = null) {
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

      // 2. Si un voyage précis est demandé (realtime / rejoindre),
      // on recharge exactement celui-là.
      if (!trip && preferredTripId) {
        const { data: preferredTrip, error: preferredTripError } =
          await supabase
            .from("trips")
            .select("*")
            .eq("id", preferredTripId)
            .maybeSingle();

        if (preferredTripError) throw preferredTripError;

        trip = preferredTrip;
      }

      // 3. Sinon, on reprend le dernier voyage utilisé.
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

      // 4. Aucun voyage connu :
      // on NE crée rien automatiquement.
      // Une nouvelle installation doit explicitement créer
      // ou rejoindre un voyage.
      if (!trip) {
        setTripId(null);
        setNoTrip(true);
        return;
      }

      // Compatibilité avec d'anciens voyages créés
      // avant l'ajout systématique du code de partage.
      if (!trip.share_code) {
        const newShareCode = generateShareCode();

        const { data: updatedTrip, error: shareCodeError } = await supabase
          .from("trips")
          .update({
            share_code: newShareCode,
          })
          .eq("id", trip.id)
          .select()
          .single();

        if (shareCodeError) throw shareCodeError;

        trip = updatedTrip;
      }

      setNoTrip(false);
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
        expenses: sortExpenses(
          (expenses || []).map(dbExpenseToApp),
        ),
      });
    } catch (err) {
      console.error(err);
      setError(err?.message || "Impossible de charger les données Supabase.");
    } finally {
      setLoading(false);
    }
  }

  async function createNewTrip() {
    if (creatingTrip) return;

    try {
      setCreatingTrip(true);
      setError("");

      const { data: createdTrip, error: createError } = await supabase
        .from("trips")
        .insert({
          name: "Mon voyage",
          share_code: generateShareCode(),
        })
        .select()
        .single();

      if (createError) throw createError;

      const { error: participantError } = await supabase
        .from("participants")
        .insert([
          {
            trip_id: createdTrip.id,
            name: "Moi",
          },
          {
            trip_id: createdTrip.id,
            name: "Mon conjoint",
          },
        ]);

      if (participantError) {
        // Évite de laisser un voyage orphelin si la création
        // des participants échoue.
        await supabase
          .from("trips")
          .delete()
          .eq("id", createdTrip.id);

        throw participantError;
      }

      localStorage.setItem(
        "voyage-depenses-trip-id",
        createdTrip.id,
      );

      localStorage.setItem(
        "voyage-depenses-share-code",
        createdTrip.share_code,
      );

      setNoTrip(false);

      await loadFromSupabase(createdTrip.id);

      // Ouvre immédiatement l'éditeur pour configurer
      // le nouveau voyage.
      setTripEditSnapshot(null);
      setShowTrip(true);
    } catch (err) {
      console.error(err);
      setError(
        err?.message ||
          "Impossible de créer le voyage.",
      );
    } finally {
      setCreatingTrip(false);
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

  function getTripDestinationFlag(country) {
    const normalized = String(country || "")
      .trim()
      .toLocaleLowerCase("fr");

    if (normalized.includes("alban")) return "🇦🇱";
    if (normalized.includes("kosovo")) return "🇽🇰";

    if (
      normalized.includes("macédoine") ||
      normalized.includes("macedoine") ||
      normalized.includes("north macedonia")
    ) {
      return "🇲🇰";
    }

    return "✦";
  }

  function getTripDestinations() {
    return String(data.trip.countries || "")
      .split(/[,·]/)
      .map((country) => country.trim())
      .filter(Boolean);
  }

  function setTripDestinations(destinations) {
    setData((current) => ({
      ...current,
      trip: {
        ...current.trip,
        countries: destinations.join(", "),
      },
    }));
  }

  function addTripDestination() {
    const destination = tripDestinationDraft.trim();

    if (!destination) return;

    const destinations = getTripDestinations();

    const alreadyExists = destinations.some(
      (item) =>
        item.localeCompare(destination, "fr", {
          sensitivity: "base",
        }) === 0,
    );

    if (alreadyExists) {
      setTripDestinationDraft("");
      return;
    }

    setTripDestinations([...destinations, destination]);
    setTripDestinationDraft("");
  }

  function removeTripDestination(index) {
    const destinations = getTripDestinations();

    setTripDestinations(
      destinations.filter((_, i) => i !== index),
    );
  }

  function moveTripDestination(index, direction) {
    const destinations = [...getTripDestinations()];
    const target = index + direction;

    if (
      target < 0 ||
      target >= destinations.length
    ) {
      return;
    }

    [destinations[index], destinations[target]] = [
      destinations[target],
      destinations[index],
    ];

    setTripDestinations(destinations);
  }

  function openTripEditor() {
    setTripEditSnapshot({
      trip: { ...data.trip },
      people: [...data.people],
    });

    setError("");
    setShowTrip(true);
  }

  function closeTripEditor() {
    if (tripEditSnapshot) {
      setData((current) => ({
        ...current,
        trip: { ...tripEditSnapshot.trip },
        people: [...tripEditSnapshot.people],
      }));
    }

    setTripEditSnapshot(null);
    setError("");
    setShowTrip(false);
  }

  async function saveTrip(e) {
    e.preventDefault();
  
    if (!tripId) return;
  
    const person1 = data.people[0]?.trim();
    const person2 = data.people[1]?.trim();

    if (
      data.trip.start &&
      data.trip.end &&
      new Date(`${data.trip.end}T00:00:00`) <
        new Date(`${data.trip.start}T00:00:00`)
    ) {
      setError(
        "La date de retour doit être après la date de départ.",
      );
      return;
    }

  
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
  
      // On récupère les noms actuellement enregistrés
      // avant de les remplacer.
      const { data: currentParticipants, error: currentParticipantsError } =
        await supabase
          .from("participants")
          .select("id, name")
          .eq("trip_id", tripId);
  
      if (currentParticipantsError) {
        throw currentParticipantsError;
      }
  
      const oldNamesById = Object.fromEntries(
        (currentParticipants || []).map((participant) => [
          participant.id,
          participant.name,
        ]),
      );
  
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
  
      // Sauvegarde des noms + migration sécurisée des anciens payeurs.
      //
      // La migration se fait en deux phases pour supporter sans collision
      // des changements comme :
      //   Vincent -> Marie
      //   Marie   -> Vincent
      const renameOperations = participantIds
        .map((participantId, index) => {
          const oldName = oldNamesById[participantId];
          const newName = data.people[index]?.trim();

          return {
            participantId,
            oldName,
            newName,
            tempName: `__payer_tmp_${participantId}_${Date.now()}_${index}__`,
          };
        })
        .filter(
          ({ oldName, newName }) =>
            oldName &&
            newName &&
            oldName !== newName,
        );

      // Phase 1 :
      // déplace les anciens noms de payeur vers des valeurs temporaires.
      for (const operation of renameOperations) {
        const { error: tempExpenseError } = await supabase
          .from("expenses")
          .update({
            payer: operation.tempName,
          })
          .eq("trip_id", tripId)
          .eq("payer", operation.oldName);

        if (tempExpenseError) {
          throw tempExpenseError;
        }
      }

      // Met à jour les noms des participants.
      for (let i = 0; i < participantIds.length; i++) {
        const participantId = participantIds[i];
        const newName = data.people[i]?.trim();

        const { error: participantError } = await supabase
          .from("participants")
          .update({
            name: newName,
          })
          .eq("id", participantId);

        if (participantError) {
          throw participantError;
        }
      }

      // Phase 2 :
      // applique les nouveaux noms aux dépenses historiques.
      for (const operation of renameOperations) {
        const { error: finalExpenseError } = await supabase
          .from("expenses")
          .update({
            payer: operation.newName,
          })
          .eq("trip_id", tripId)
          .eq("payer", operation.tempName);

        if (finalExpenseError) {
          throw finalExpenseError;
        }
      }

      await loadFromSupabase(tripId);

      setTripEditSnapshot(null);
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
      setForm((current) => {
        // La personne a peut-être choisi une autre devise
        // pendant que la requête réseau était en cours.
        if (!current || current.currency !== currency) {
          return current;
        }

        return {
          ...current,
          rate,
        };
      });
    }
  }

  function closeExpenseEditor() {
    setShowExpense(false);
    setForm(null);
    setEditing(null);
    setError("");
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
            personal: true,
            splitMode: "personal1",
            split: 100,
            payer: data.people[0],
          };
  
        case "personal2":
          return {
            ...current,
            personal: true,
            splitMode: "personal2",
            split: 0,
            payer: data.people[1],
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

    const amount = parseAmountInput(form.amount);

    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Entre un montant supérieur à 0.");
      return;
    }

    try {
      setSaving(true);
      setError("");

      let rate = 1;

      if (form.currency !== "CAD") {
        const editingSameCurrency =
          editing &&
          editing.currency === form.currency &&
          Number(editing.rate) > 0;

        if (editingSameCurrency) {
          // Une modification de description, catégorie, date, etc.
          // ne doit jamais changer rétroactivement le taux historique.
          rate = Number(editing.rate);
        } else {
          // Pour une nouvelle dépense ou une devise nouvellement choisie,
          // on sauvegarde exactement le taux affiché dans le formulaire.
          rate = Number(form.rate);

          // Sécurité si le taux n'était pas encore disponible.
          if (!rate || !Number.isFinite(rate)) {
            rate = await getRate(form.currency);
          }
        }
      }

      if (!rate || !Number.isFinite(rate)) {
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
          expenses: sortExpenses(
            current.expenses.map((expense) =>
              expense.id === editing.id ? dbExpenseToApp(updated) : expense,
            ),
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
          expenses: sortExpenses([
            dbExpenseToApp(created),
            ...current.expenses,
          ]),
        }));
      }

      closeExpenseEditor();
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

    if (expense.personal && expense.split === 100) {
      splitMode = "personal1";
    } else if (expense.personal && expense.split === 0) {
      splitMode = "personal2";
    } else if (!expense.personal && expense.split === 50) {
      splitMode = "equal";
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

    let net = 0;

    if (data.people.length >= 2) {
      const a = data.people[0];
      const b = data.people[1];

      shared.forEach((expense) => {
        // split = pourcentage de la dépense appartenant à A.
        const shareA = Math.min(
          1,
          Math.max(0, Number(expense.split ?? 50) / 100),
        );

        const shareB = 1 - shareA;

        if (expense.payer === a) {
          // A a payé.
          // B doit rembourser à A la part qui appartient à B.
          net += expense.cad * shareB;
        } else if (expense.payer === b) {
          // B a payé.
          // A doit rembourser à B la part qui appartient à A.
          net -= expense.cad * shareA;
        }
      });
    }

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

  if (noTrip) {
    return (
      <div className="app tripOnboardingApp">
        <main className="tripOnboarding">
          <div className="tripOnboardingIcon">
            <Plane size={30} strokeWidth={1.9} />
          </div>

          <div className="tripOnboardingCopy">
            <span>VOYAGE DÉPENSES</span>

            <h1>Ton prochain voyage commence ici.</h1>

            <p>
              Crée un nouveau voyage ou rejoins celui
              d'un compagnon avec son code de partage.
            </p>
          </div>

          {error && (
            <div className="tripOnboardingError">
              {error}
            </div>
          )}

          <div className="tripOnboardingActions">
            <button
              type="button"
              className="tripOnboardingPrimary"
              onClick={createNewTrip}
              disabled={creatingTrip}
            >
              <Plus size={20} />
              {creatingTrip
                ? "Création…"
                : "Créer un voyage"}
            </button>

            <button
              type="button"
              className="tripOnboardingSecondary"
              onClick={() => setShowJoin(true)}
            >
              Rejoindre un voyage
            </button>
          </div>

          {showJoin && (
            <Modal
              title="Rejoindre un voyage"
              close={() => {
                setShowJoin(false);
                setJoinCode("");
              }}
            >
              <form
                className="form"
                onSubmit={joinTripByCode}
              >
                <p>
                  Entre le code de partage que ton
                  compagnon t'a donné.
                </p>

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
                      setJoinCode(
                        e.target.value.toUpperCase(),
                      )
                    }
                  />
                </label>

                <button
                  className="primary"
                  disabled={joining}
                >
                  {joining
                    ? "Connexion…"
                    : "Rejoindre le voyage"}
                </button>
              </form>
            </Modal>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="travelAppHeader">
        <div className="travelHeaderSide travelHeaderWallet">
          <button
            className="travelHeaderIcon"
            onClick={openTripEditor}
            title="Voyage"
            aria-label="Voyage"
          >
            <Wallet size={20} strokeWidth={1.9} />
          </button>
        </div>

        <div className="travelHeaderCenter">
          <div className="travelHeaderPlane" aria-hidden="true">
            <Plane size={25} strokeWidth={1.9} />
          </div>

          <div className="travelHeaderTitle">
            Voyage Dépenses
          </div>
        </div>

        <div className="travelHeaderSide travelHeaderAdd">
          <button
            className="travelHeaderIcon travelHeaderPlus"
            onClick={() => setShowJoin(true)}
            title="Rejoindre un voyage"
            aria-label="Rejoindre un voyage"
          >
            <Plus size={25} strokeWidth={1.9} />
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
            onTrip={openTripEditor}
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
          className={screen === "dashboard" ? "navItem active" : "navItem"}
          onClick={() => setScreen("dashboard")}
          aria-label="Accueil"
        >
          <House size={21} strokeWidth={2.2} />
          <span>Accueil</span>
        </button>

        <button
          className="navAdd"
          onClick={newExpense}
          aria-label="Ajouter une dépense"
        >
          <Plus size={25} strokeWidth={2.6} />
        </button>

        <button
          className={screen === "history" ? "navItem active" : "navItem"}
          onClick={() => setScreen("history")}
          aria-label="Dépenses"
        >
          <ReceiptText size={21} strokeWidth={2.2} />
          <span>Dépenses</span>
        </button>
      </nav>

      {showTrip && (
        <Modal title="Mon voyage" close={closeTripEditor}>
          <form
            onSubmit={saveTrip}
            className="form tripManager"
          >

            {/* ============================
                APERÇU
               ============================ */}

            <section className="tripManagerHero">

              <span className="tripManagerEyebrow">
                MON VOYAGE
              </span>

              <h2>
                {data.trip.name?.trim() || "Mon voyage"}
              </h2>

              <div className="tripManagerSummary">
                <span>
                  <strong>{tripEditorDays || "—"}</strong>
                  {tripEditorDays === 1 ? " jour" : " jours"}
                </span>

                <span>
                  <strong>{getTripDestinations().length}</strong>
                  {" "}
                  {getTripDestinations().length === 1
                    ? "pays"
                    : "pays"}
                </span>

                <span>
                  <strong>{data.people.length}</strong>
                  {" "}
                  {data.people.length === 1
                    ? "voyageur"
                    : "voyageurs"}
                </span>
              </div>

            </section>

            {/* ============================
                INFORMATIONS
               ============================ */}

            <section className="tripManagerCard">

              <div className="tripManagerSectionHead">
                <span>INFORMATIONS</span>
                <h3>Les essentiels</h3>
              </div>

              <label className="tripManagerField">
                <span>Nom du voyage</span>

                <input
                  type="text"
                  value={data.trip.name}
                  placeholder="Ex. Balkans 2026"
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

            </section>

            {/* ============================
                DATES
               ============================ */}

            <section className="tripManagerCard">

              <div className="tripManagerSectionHead">
                <span>DATES</span>
                <h3>Quand pars-tu?</h3>
              </div>

              <div className="tripManagerDateGrid">

                <label className="tripManagerField">
                  <span>Départ</span>

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

                <label className="tripManagerField">
                  <span>Retour</span>

                  <input
                    type="date"
                    min={data.trip.start || undefined}
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

              </div>

              {(data.trip.start || data.trip.end) && (
                <div className="tripManagerDatePreview">
                  <div>
                    <span>DÉPART</span>
                    <strong>
                      {tripEditorFormatDate(data.trip.start)}
                    </strong>
                  </div>

                  <i>→</i>

                  <div>
                    <span>RETOUR</span>
                    <strong>
                      {tripEditorFormatDate(data.trip.end)}
                    </strong>
                  </div>
                </div>
              )}

              {data.trip.start &&
                data.trip.end &&
                tripEditorDays && (
                  <div className="tripManagerDuration">
                    <div>
                      <strong>{tripEditorDays}</strong>
                      <span>
                        {tripEditorDays === 1
                          ? "jour"
                          : "jours"}
                      </span>
                    </div>

                    <p>Durée totale du voyage</p>
                  </div>
                )}

              {data.trip.start &&
                data.trip.end &&
                !tripEditorDays && (
                  <div className="tripManagerWarning">
                    La date de retour doit être après
                    la date de départ.
                  </div>
                )}

            </section>

            {/* ============================
                ITINÉRAIRE
               ============================ */}

            <section className="tripManagerCard">

              <div className="tripManagerSectionHead">
                <span>ITINÉRAIRE</span>
                <h3>Ton parcours</h3>
              </div>

              {getTripDestinations().length > 0 && (
                <div className="tripManagerRoute">

                  {getTripDestinations().map(
                    (country, index) => (
                      <div
                        className="tripManagerStop"
                        key={`${country}-${index}`}
                      >
                        <div className="tripManagerStopOrder">
                          <span className="tripManagerStopFlag">
                            {getTripDestinationFlag(country)}
                          </span>

                          <small>{index + 1}</small>
                        </div>

                        <div className="tripManagerStopName">
                          <strong>{country}</strong>

                          <small>
                            {index === 0
                              ? "Début du voyage"
                              : index ===
                                  getTripDestinations().length - 1
                                ? "Dernière étape"
                                : `Étape ${index + 1}`}
                          </small>
                        </div>

                        <div className="tripManagerStopActions">

                          <button
                            type="button"
                            onClick={() =>
                              moveTripDestination(
                                index,
                                -1,
                              )
                            }
                            disabled={index === 0}
                            aria-label="Monter"
                          >
                            ‹
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              moveTripDestination(
                                index,
                                1,
                              )
                            }
                            disabled={
                              index ===
                              getTripDestinations().length - 1
                            }
                            aria-label="Descendre"
                          >
                            ›
                          </button>

                          <button
                            type="button"
                            className="danger"
                            onClick={() =>
                              removeTripDestination(index)
                            }
                            aria-label={`Supprimer ${country}`}
                          >
                            ×
                          </button>

                        </div>
                      </div>
                    ),
                  )}

                </div>
              )}

              <div className="tripManagerAddStop">

                <input
                  type="text"
                  value={tripDestinationDraft}
                  placeholder="Ajouter une destination"
                  onChange={(e) =>
                    setTripDestinationDraft(
                      e.target.value,
                    )
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTripDestination();
                    }
                  }}
                />

                <button
                  type="button"
                  onClick={addTripDestination}
                  disabled={!tripDestinationDraft.trim()}
                >
                  +
                </button>

              </div>

              <small className="tripManagerHint">
                Ajoute les pays dans l'ordre du voyage.
              </small>

            </section>

            {/* ============================
                BUDGET
               ============================ */}

            <section className="tripManagerCard">

              <div className="tripManagerSectionHead">
                <span>BUDGET</span>
                <h3>Ton enveloppe</h3>
              </div>

              <label className="tripManagerField">
                <span>Budget total</span>

                <div className="tripManagerMoneyInput">

                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    value={data.trip.budget}
                    placeholder="0"
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

                  <strong>CAD</strong>

                </div>
              </label>

              {Number(data.trip.budget) > 0 && (
                <div className="tripManagerBudgetGrid">

                  <div>
                    <span>BUDGET TOTAL</span>
                    <strong>
                      {tripEditorCompactMoney(
                        Number(data.trip.budget),
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>PAR JOUR</span>
                    <strong>
                      {tripEditorDays
                        ? tripEditorCompactMoney(
                            Number(data.trip.budget) /
                              tripEditorDays,
                          )
                        : "—"}
                    </strong>
                  </div>

                  <div>
                    <span>PAR PERSONNE</span>
                    <strong>
                      {data.people.length > 0
                        ? tripEditorCompactMoney(
                            Number(data.trip.budget) /
                              data.people.length,
                          )
                        : "—"}
                    </strong>
                  </div>

                  <div>
                    <span>PERS. / JOUR</span>
                    <strong>
                      {tripEditorDays &&
                      data.people.length > 0
                        ? tripEditorCompactMoney(
                            Number(data.trip.budget) /
                              tripEditorDays /
                              data.people.length,
                          )
                        : "—"}
                    </strong>
                  </div>

                </div>
              )}

            </section>

            {/* ============================
                VOYAGEURS
               ============================ */}

            <section className="tripManagerCard">

              <div className="tripManagerSectionHead">
                <span>VOYAGEURS</span>
                <h3>Qui part?</h3>
              </div>

              <div className="tripManagerTravellers">

                {data.people.map((person, index) => (
                  <label
                    className="tripManagerTraveller"
                    key={participantIds[index] || index}
                  >

                    <div className="tripManagerAvatar">
                      {(person || `V${index + 1}`)
                        .charAt(0)
                        .toUpperCase()}
                    </div>

                    <div>
                      <span>
                        Voyageur {index + 1}
                      </span>

                      <input
                        type="text"
                        value={person}
                        maxLength={40}
                        onChange={(e) =>
                          setData((current) => ({
                            ...current,
                            people:
                              current.people.map(
                                (p, i) =>
                                  i === index
                                    ? e.target.value
                                    : p,
                              ),
                          }))
                        }
                      />
                    </div>

                  </label>
                ))}

              </div>

            </section>

            {/* ============================
                PARTAGE
               ============================ */}

            <section className="tripManagerCard">

              <div className="tripManagerSectionHead">
                <span>PARTAGE</span>
                <h3>Voyager ensemble</h3>
              </div>

              <div className="tripManagerShare">

                <div>
                  <span>CODE DU VOYAGE</span>
                  <strong>
                    {data.trip.shareCode || "—"}
                  </strong>
                </div>

                <button
                  type="button"
                  disabled={!data.trip.shareCode}
                  onClick={async () => {
                    if (!data.trip.shareCode) return;

                    try {
                      await navigator.clipboard.writeText(
                        data.trip.shareCode,
                      );
                    } catch (err) {
                      console.error(
                        "Impossible de copier le code",
                        err,
                      );
                    }
                  }}
                >
                  Copier
                </button>

              </div>

              <p className="tripManagerHint">
                Ton compagnon peut utiliser ce code
                pour rejoindre le même voyage.
              </p>

            </section>

            {error && (
              <div className="tripManagerError">
                {error}
              </div>
            )}

            <div className="tripManagerFooter">

              <button
                type="button"
                className="tripManagerCancel"
                onClick={closeTripEditor}
                disabled={saving}
              >
                Annuler
              </button>

              <button
                type="submit"
                className="tripManagerSave"
                disabled={saving}
              >
                {saving
                  ? "Enregistrement…"
                  : "Enregistrer"}
              </button>

            </div>

          </form>
        </Modal>
      )}

      {showExpense && form && (
        <Modal
          title={editing ? "Modifier la dépense" : "Ajouter une dépense"}
          close={closeExpenseEditor}
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
                  min="0.01"
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
            {form.amount && parseAmountInput(form.amount) > 0 && (
              <div className="liveConversion mobileLiveConversion">
                <div className="liveConversionMain">
                  <span>≈</span>

                  <strong>
                    {form.currency === "CAD"
                      ? money(parseAmountInput(form.amount))
                      : form.rate
                        ? money(
                            parseAmountInput(form.amount) * Number(form.rate),
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

{/* PAYEUR + DATE */}
<div className="expenseQuickFields expensePayerDateFields">

  <div className="expenseQuickField expensePayerField">
    <span>Payé par</span>

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

  <label className="expenseQuickField expenseDateField">
    <span>Date</span>

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
  </label>

</div>

{/* CATÉGORIE */}
<div className="expenseChoiceSection">
  <label>Catégorie</label>

  <div className="expenseCategoryGrid">
    {data.categories.map((category) => {
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
        <button
          key={category}
          type="button"
          className={
            form.category === category
              ? "expenseCategoryChoice active"
              : "expenseCategoryChoice"
          }
          onClick={() =>
            setForm({
              ...form,
              category,
            })
          }
        >
          <span className="expenseCategoryEmoji">
            {icons[category] || "📦"}
          </span>

          <span>{category}</span>
        </button>
      );
    })}
  </div>
</div>

            {/* DESCRIPTION + LIEU */}
            <div className="expenseQuickFields expenseOptionalFields">

              <label className="expenseQuickField">
                <span>Description (facultatif)</span>
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

              <label className="expenseQuickField">
                <span>Lieu (facultatif)</span>
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

            </div>
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
            parseAmountInput(form.amount) *
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
            parseAmountInput(form.amount) *
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
            <button
              className="primary expenseSaveButton"
              disabled={saving || parseAmountInput(form.amount) <= 0}
            >
              {saving
                ? "Enregistrement…"
                : `Enregistrer · ${money(parseAmountInput(form.amount))}`}
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}



/* =========================================================
   BALKAN SMART LOCATION
   ========================================================= */

function getBalkanLocation(expense) {
  const text = [
    expense?.place,
    expense?.description,
    expense?.category,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const cities = [
    {
      country: "Albanie",
      flag: "🇦🇱",
      names: ["tirana", "tiranë", "durres", "durrës", "shkoder", "shkodër", "berat", "vlore", "vlorë", "sarande", "sarandë", "gjirokaster", "gjirokastër", "kruje", "krujë"],
    },
    {
      country: "Kosovo",
      flag: "🇽🇰",
      names: ["prizren", "pristina", "prishtina", "peja", "gjakova", "ferizaj", "mitrovica"],
    },
    {
      country: "Macédoine du Nord",
      flag: "🇲🇰",
      names: ["skopje", "skopjë", "ohrid", "ohrid", "bitola", "tetovo", "struga"],
    },
  ];

  for (const country of cities) {
    for (const city of country.names) {
      if (text.includes(city)) {
        return {
          city: city.charAt(0).toUpperCase() + city.slice(1),
          country: country.country,
          flag: country.flag,
        };
      }
    }
  }

  const countries = [
    {
      country: "Albanie",
      flag: "🇦🇱",
      names: ["albanie", "albania"],
    },
    {
      country: "Kosovo",
      flag: "🇽🇰",
      names: ["kosovo"],
    },
    {
      country: "Macédoine du Nord",
      flag: "🇲🇰",
      names: ["macédoine", "macedonie", "macedonia", "north macedonia"],
    },
  ];

  for (const country of countries) {
    if (country.names.some((name) => text.includes(name))) {
      return {
        city: null,
        country: country.country,
        flag: country.flag,
      };
    }
  }

  return null;
}


function getBalkanRoute(expenses) {
  const sorted = [...expenses].sort((a, b) => {
    const dateA = new Date(a.date || 0).getTime();
    const dateB = new Date(b.date || 0).getTime();

    if (dateA !== dateB) return dateA - dateB;

    return String(a.id || "").localeCompare(String(b.id || ""));
  });

  const route = [];

  for (const expense of sorted) {
    const location = getBalkanLocation(expense);

    if (!location) continue;

    const key = `${location.city || location.country}`;

    const previous = route[route.length - 1];

    if (previous?.key === key) {
      previous.amount += Number(expense.cad) || 0;
      previous.expenses += 1;
      continue;
    }

    route.push({
      key,
      city: location.city,
      country: location.country,
      flag: location.flag,
      amount: Number(expense.cad) || 0,
      expenses: 1,
    });
  }

  return route;
}

function Dashboard({ data, stats, onAdd, onHistory, onTrip }) {
  const tripDays = (() => {
    if (!data.trip.start || !data.trip.end) return null;

    const start = new Date(data.trip.start);
    const end = new Date(data.trip.end);

    const diff = Math.ceil(
      (end - start) / (1000 * 60 * 60 * 24),
    );

    return Math.max(1, diff + 1);
  })();

  // Dépense moyenne réelle sur la durée complète du voyage.
  // Utilisée seulement pour les données de dépenses.
  const actualDailyAverage =
    tripDays && stats.total > 0
      ? stats.total / tripDays
      : 0;

  // Budget quotidien planifié.
  // C'est cette valeur qui doit apparaître dans le Hero.
  const plannedDailyBudget =
    tripDays && Number(data.trip.budget) > 0
      ? Number(data.trip.budget) / tripDays
      : 0;

  const balkanRoute = getBalkanRoute(data.expenses);

  // Résumé des lieux réellement enregistrés dans les dépenses.
  const registeredRouteExpenseCount = balkanRoute.reduce(
    (sum, stop) => sum + Number(stop.expenses || 0),
    0,
  );

  const averagePerPerson =
    data.people.length > 0
      ? stats.total / data.people.length
      : 0;

  /* =========================================================
     TRAVEL INTELLIGENCE
     ========================================================= */

  const todayDate = new Date();
  todayDate.setHours(0, 0, 0, 0);

  const tripStartDate = data.trip.start
    ? new Date(`${data.trip.start}T00:00:00`)
    : null;

  const tripEndDate = data.trip.end
    ? new Date(`${data.trip.end}T00:00:00`)
    : null;

  const tripHasStarted =
    tripStartDate && todayDate >= tripStartDate;

  const tripHasEnded =
    tripEndDate && todayDate > tripEndDate;

  const elapsedTripDays =
    tripDays && tripStartDate
      ? Math.min(
          tripDays,
          Math.max(
            1,
            Math.floor(
              (todayDate - tripStartDate) /
                (1000 * 60 * 60 * 24),
            ) + 1,
          ),
        )
      : null;

  const remainingTripDays =
    tripDays && elapsedTripDays && !tripHasEnded
      ? Math.max(0, tripDays - elapsedTripDays)
      : 0;

  const intelligenceBurnRate =
    elapsedTripDays && stats.total > 0
      ? stats.total / elapsedTripDays
      : actualDailyAverage;

  const projectedTripCost =
    tripDays && intelligenceBurnRate > 0
      ? intelligenceBurnRate * tripDays
      : 0;

  const budgetAmount =
    Number(data.trip.budget) > 0
      ? Number(data.trip.budget)
      : 0;

  const compactMoney = (value) => {
    const amount = Number(value);

    if (!Number.isFinite(amount)) return "—";

    return `${new Intl.NumberFormat("fr-CA", {
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    }).format(amount)} $`;
  };

  const budgetRemaining =
    budgetAmount > 0
      ? budgetAmount - stats.total
      : null;

  const requiredDailyBudget =
    budgetRemaining !== null &&
    remainingTripDays > 0
      ? Math.max(0, budgetRemaining) /
        remainingTripDays
      : null;

  const burnVsRequired =
    requiredDailyBudget > 0 &&
    intelligenceBurnRate > 0
      ? intelligenceBurnRate /
        requiredDailyBudget
      : null;

  const projectionDelta =
    budgetAmount > 0 &&
    projectedTripCost > 0
      ? projectedTripCost - budgetAmount
      : null;

  const intelligenceStatus =
    budgetAmount <= 0
      ? "neutral"
      : projectionDelta <= 0
        ? "on-track"
        : projectionDelta <= budgetAmount * 0.1
          ? "watch"
          : "hot";

  const intelligenceHeadline =
    !tripHasStarted
      ? "Prêt pour le départ"
      : tripHasEnded
        ? "Voyage terminé"
        : budgetAmount <= 0
          ? "Ton rythme de voyage"
          : projectionDelta <= 0
            ? "Tu es dans les temps"
            : "Le rythme monte";

  const intelligenceMessage =
    !tripHasStarted
      ? budgetAmount > 0 && tripStartDate && tripEndDate && tripDays && data.people.length > 0
        ? `Ton budget te donne ${money(
            budgetAmount / tripDays,
          )} par jour, soit ${money(
            budgetAmount / tripDays / data.people.length,
          )} par personne / jour.`
        : budgetAmount > 0 && data.people.length > 0
          ? `Ton budget voyage est de ${compactMoney(
              budgetAmount,
            )}, soit ${compactMoney(
              budgetAmount / data.people.length,
            )} par personne.`
          : "Ajoute ton budget et tes dates pour préparer ton rythme de voyage."
      : tripHasEnded
        ? "Voici ce que ton rythme réel raconte sur le voyage."
        : budgetAmount <= 0
          ? `Tu dépenses environ ${money(intelligenceBurnRate)} par jour.`
          : projectionDelta <= 0
            ? "À ce rythme, tu devrais rester sous ton budget."
            : `À ce rythme, tu dépasserais le budget d'environ ${money(projectionDelta)}.`;

  const isBalanced =
    data.people.length < 2 ||
    Math.abs(stats.net) < 0.005;

  const debtor =
    stats.net > 0
      ? data.people[1]
      : data.people[0];

  const creditor =
    stats.net > 0
      ? data.people[0]
      : data.people[1];

  const budgetPercentage =
    stats.budget > 0
      ? Math.min(100, Math.max(0, (stats.total / stats.budget) * 100))
      : 0;

  const categories = Object.entries(
    data.expenses.reduce((result, expense) => {
      const category = expense.category || "Autre";
      result[category] = (result[category] || 0) + expense.cad;
      return result;
    }, {}),
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const categoryTotal = categories.reduce(
    (sum, [, amount]) => sum + amount,
    0,
  );

  const tripCountries = String(data.trip.countries || "")
    .split(/[·,;|]/)
    .map((country) => country.trim())
    .filter(Boolean);

  const countryText =
    tripCountries.length > 0
      ? tripCountries.join(" · ")
      : "Destination à définir";

  const destinationFlag = (country) => {
    const normalized = String(country || "")
      .trim()
      .toLocaleLowerCase("fr");

    const flags = {
      "albanie": "🇦🇱",
      "albani": "🇦🇱",
      "kosovo": "🇽🇰",
      "macédoine": "🇲🇰",
      "macedoine": "🇲🇰",
      "macédoine du nord": "🇲🇰",
      "macedoine du nord": "🇲🇰",
      "north macedonia": "🇲🇰",
      "monténégro": "🇲🇪",
      "montenegro": "🇲🇪",
      "croatie": "🇭🇷",
      "croatia": "🇭🇷",
      "serbie": "🇷🇸",
      "serbia": "🇷🇸",
      "bosnie-herzégovine": "🇧🇦",
      "bosnie herzégovine": "🇧🇦",
      "bosnia and herzegovina": "🇧🇦",
      "slovénie": "🇸🇮",
      "slovenie": "🇸🇮",
      "slovenia": "🇸🇮",
      "grèce": "🇬🇷",
      "grece": "🇬🇷",
      "greece": "🇬🇷",
    };

    return flags[normalized] || "📍";
  };

  const heroRouteLabel =
    tripCountries.length > 1
      ? `${tripCountries.length} PAYS · ROAD TRIP`
      : tripCountries.length === 1
        ? "VOYAGE"
        : "PROCHAIN VOYAGE";

  const recentExpenses = [...data.expenses]
    .sort((a, b) => {
      const dateA = new Date(a.date || 0).getTime();
      const dateB = new Date(b.date || 0).getTime();
      return dateB - dateA;
    })
    .slice(0, 4);

  return (
    <section className="balkanDashboard">

      {/* =================================================
          TRIP HERO
         ================================================= */}

      <div className="balkanHero">

        <div className="balkanHeroNoise" />

        <div className="balkanHeroTop">
          <div className="balkanPassport">
            <span>TRIP</span>
            <strong>01</strong>
          </div>

          <button
            type="button"
            className="balkanEdit"
            onClick={onTrip}
            aria-label="Modifier le voyage"
          >
            <Pencil size={16} />
          </button>
        </div>

        <div className="balkanRouteLabel">
          <span className="routePulse" />
          {heroRouteLabel}
        </div>

        <h1>{data.trip.name || "Balkan Escape"}</h1>

        <div className="balkanRoute">
          {tripCountries.length > 0 ? (
            tripCountries.map((country, index) => (
              <React.Fragment key={`${country}-${index}`}>
                {index > 0 && <i />}
                <span
                  title={country}
                  aria-label={country}
                >
                  {destinationFlag(country)}
                </span>
              </React.Fragment>
            ))
          ) : (
            <span>📍</span>
          )}
        </div>

        <p className="balkanCountries">
          {countryText}
        </p>

        <div className="balkanHeroStats balkanHeroStatsPolished">
          <div>
            <strong>{tripDays || "—"}</strong>
            <span>{tripDays === 1 ? "jour" : "jours"}</span>
          </div>

          <div>
            <strong>{data.people.length}</strong>
            <span>voyageurs</span>
          </div>

          <div>
            <strong>
              {plannedDailyBudget > 0
                ? compactMoney(plannedDailyBudget)
                : "—"}
            </strong>
            <span>/ jour</span>
          </div>
        </div>

      </div>

      {/* =================================================
          QUICK ACTION
         ================================================= */}

      <button
        type="button"
        className="balkanAddExpense"
        onClick={onAdd}
      >
        <span className="balkanAddIcon">+</span>

        <span className="balkanAddText">
          <strong>Ajouter une dépense</strong>
          <small>Note ton prochain arrêt</small>
        </span>

        <span className="balkanAddArrow">↗</span>
      </button>

      {/* =================================================
          MONEY SNAPSHOT
         ================================================= */}

      <div className="balkanSectionHead">
        <div>
          <span>TRAVEL MONEY</span>
          <h2>État du voyage</h2>
        </div>

        <span className="balkanLive">
          ● LIVE
        </span>
      </div>

      <div className="balkanMoneyGrid">

        <div className="balkanTotalCard">
          <div className="balkanCardLabel">
            <span>Total dépensé</span>
            <span className="balkanTinyFlag">€ / $</span>
          </div>

          <strong>{money(stats.total)}</strong>

          <small>
            {data.expenses.length} dépense
            {data.expenses.length > 1 ? "s" : ""}
            {averagePerPerson > 0
              ? ` · ${money(averagePerPerson)} / personne`
              : ""}
          </small>
        </div>

        <div className="balkanBudgetCard">

          <div className="balkanCardLabel">
            <span>Budget</span>
            <span>{stats.budget > 0 ? `${budgetPercentage.toFixed(0)}%` : "—"}</span>
          </div>

          <strong>
            {stats.budget > 0
              ? money(stats.remaining)
              : "—"}
          </strong>

          <small>
            {stats.budget > 0
              ? stats.remaining >= 0
                ? "encore disponible"
                : "budget dépassé"
              : "aucun budget défini"}
          </small>

          {stats.budget > 0 && (
            <div className="balkanBudgetTrack">
              <span
                style={{
                  width: `${budgetPercentage}%`,
                }}
              />
            </div>
          )}

        </div>

      </div>

      {/* =================================================
          BALANCE
         ================================================= */}

      <div className="balkanBalance">

        <div className="balkanBalanceTop">
          <span>SETTLE UP</span>
          <span className="balkanBalanceIcon">⇄</span>
        </div>

        {data.people.length < 2 ? (
          <>
            <strong>Ajoute un deuxième voyageur</strong>
            <small>La balance apparaîtra ici.</small>
          </>
        ) : isBalanced ? (
          <>
            <strong>Tout est équilibré</strong>
            <small>Personne ne doit rien à personne.</small>
          </>
        ) : (
          <>
            <div className="balkanTransfer">
              <div className="balkanPerson">
                <span>
                  {debtor?.charAt(0).toUpperCase()}
                </span>
                <small>{debtor}</small>
              </div>

              <div className="balkanTransferLine">
                <strong>{money(Math.abs(stats.net))}</strong>
                <i>→</i>
              </div>

              <div className="balkanPerson">
                <span>
                  {creditor?.charAt(0).toUpperCase()}
                </span>
                <small>{creditor}</small>
              </div>
            </div>
          </>
        )}

      </div>

      {/* =================================================
          TRAVEL INTELLIGENCE
         ================================================= */}

      <section className={`travelIntel ${intelligenceStatus}`}>

        <div className="travelIntelHeader">

          <div>
            <span>TRAVEL INTELLIGENCE</span>

            <h2>{intelligenceHeadline}</h2>
          </div>

          <div className="travelIntelSignal">
            <i />
            <span>
              {!tripHasStarted && !tripHasEnded
                ? "PLANIFIÉ"
                : intelligenceStatus === "hot"
                  ? "ALERTE"
                  : intelligenceStatus === "watch"
                    ? "SURVEILLER"
                    : intelligenceStatus === "on-track"
                      ? "ON TRACK"
                      : "INFO"}
            </span>
          </div>

        </div>

        <p className="travelIntelMessage">
          {intelligenceMessage}
        </p>

        {/* PRÉ-DÉPART */}
        {!tripHasStarted && !tripHasEnded && (

          <div className="travelIntelMetrics travelIntelPreTrip">

            <div className="travelIntelMetric">
              <span>BUDGET TOTAL</span>

              <strong>
                {budgetAmount > 0
                  ? compactMoney(budgetAmount)
                  : "—"}
              </strong>

              <small>pour le voyage</small>
            </div>

            <div className="travelIntelMetric primary">
              <span>BUDGET / JOUR</span>

              <strong>
                {budgetAmount > 0 &&
                tripStartDate &&
                tripEndDate &&
                tripDays
                  ? compactMoney(budgetAmount / tripDays)
                  : "—"}
              </strong>

              <small>
                {tripStartDate && tripEndDate
                  ? "budget quotidien"
                  : "ajoute tes dates"}
              </small>
            </div>

            <div className="travelIntelMetric">
              <span>PAR PERSONNE</span>

              <strong>
                {budgetAmount > 0 && data.people.length > 0
                  ? compactMoney(
                      budgetAmount / data.people.length,
                    )
                  : "—"}
              </strong>

              <small>budget individuel</small>
            </div>

            <div className="travelIntelMetric">
              <span>DISPONIBLE</span>

              <strong>
                {budgetRemaining !== null
                  ? compactMoney(
                      Math.max(0, budgetRemaining),
                    )
                  : "—"}
              </strong>

              <small>avant le départ</small>
            </div>

          </div>
        )}

        {/* VOYAGE EN COURS */}
        {tripHasStarted && !tripHasEnded && (

          <>

            <div className="travelIntelMetrics">

              <div className="travelIntelMetric primary">
                <span>RYTHME</span>

                <strong>
                  {money(intelligenceBurnRate)}
                </strong>

                <small>/ jour</small>
              </div>

              <div className="travelIntelMetric">
                <span>PROJECTION</span>

                <strong>
                  {projectedTripCost > 0
                    ? money(projectedTripCost)
                    : "—"}
                </strong>

                <small>fin du voyage</small>
              </div>

              <div className="travelIntelMetric">
                <span>RESTANT</span>

                <strong>
                  {budgetRemaining !== null
                    ? money(Math.max(0, budgetRemaining))
                    : "—"}
                </strong>

                <small>budget</small>
              </div>

            </div>

            {budgetAmount > 0 && (

              <div className="travelIntelBudget">

                <div className="travelIntelBudgetTop">

                  <span>
                    Budget quotidien restant
                  </span>

                  <strong>
                    {requiredDailyBudget !== null
                      ? money(requiredDailyBudget)
                      : "—"}
                    {requiredDailyBudget !== null &&
                      " / jour"}
                  </strong>

                </div>

                <div className="travelIntelBar">
                  <i
                    style={{
                      width: `${Math.min(
                        100,
                        Math.max(
                          0,
                          (stats.total / budgetAmount) * 100,
                        ),
                      )}%`,
                    }}
                  />
                </div>

                <div className="travelIntelBudgetBottom">

                  <span>
                    {elapsedTripDays || 0} jour
                    {elapsedTripDays === 1 ? "" : "s"} écoulé
                    {elapsedTripDays === 1 ? "" : "s"}
                  </span>

                  <span>
                    {remainingTripDays} jour
                    {remainingTripDays === 1 ? "" : "s"} restant
                    {remainingTripDays === 1 ? "" : "s"}
                  </span>

                </div>

              </div>
            )}

            {burnVsRequired !== null && (

              <div className="travelIntelInsight">

                <span className="travelIntelInsightIcon">
                  {burnVsRequired <= 1 ? "↘" : "↗"}
                </span>

                <div>

                  <strong>
                    {burnVsRequired <= 1
                      ? "Ton rythme est sain."
                      : "Ton rythme est au-dessus du plan."}
                  </strong>

                  <small>
                    {burnVsRequired <= 1
                      ? `Tu dépenses ${Math.round(
                          (1 - burnVsRequired) * 100,
                        )} % sous le rythme nécessaire.`
                      : `Tu dépenses ${Math.round(
                          (burnVsRequired - 1) * 100,
                        )} % au-dessus du rythme nécessaire.`}
                  </small>

                </div>

              </div>
            )}

          </>
        )}

        {/* VOYAGE TERMINÉ */}
        {tripHasEnded && (

          <div className="travelIntelMetrics">

            <div className="travelIntelMetric primary">
              <span>COÛT FINAL</span>

              <strong>
                {money(stats.total)}
              </strong>

              <small>total du voyage</small>
            </div>

            <div className="travelIntelMetric">
              <span>MOYENNE / JOUR</span>

              <strong>
                {tripDays
                  ? money(stats.total / tripDays)
                  : "—"}
              </strong>

              <small>par jour</small>
            </div>

            <div className="travelIntelMetric">
              <span>BUDGET</span>

              <strong>
                {budgetAmount > 0
                  ? compactMoney(budgetAmount)
                  : "—"}
              </strong>

              <small>
                {projectionDelta !== null
                  ? projectionDelta <= 0
                    ? "sous le budget"
                    : "au-dessus du budget"
                  : "non défini"}
              </small>
            </div>

          </div>
        )}

      </section>

      {/* =================================================
          YOUR ROUTE
         ================================================= */}

      {balkanRoute.length > 0 && (
        <section className="balkanRouteSection">
          <div className="balkanSectionHead">
            <div>
              <span>JOURNEY</span>
              <h2>Étapes enregistrées</h2>
            </div>

            <strong>
              {balkanRoute.length}{" "}
              {balkanRoute.length === 1 ? "lieu" : "lieux"}
              {" · "}
              {registeredRouteExpenseCount}{" "}
              {registeredRouteExpenseCount === 1
                ? "dépense"
                : "dépenses"}
            </strong>
          </div>

          <div className="balkanRouteTrack">
            {balkanRoute.map((stop, index) => (
              <div
                className="balkanRouteStop"
                key={`${stop.key}-${index}`}
              >
                <div className="balkanRouteNode">
                  <span>{stop.flag}</span>

                  {index < balkanRoute.length - 1 && (
                    <i />
                  )}
                </div>

                <div className="balkanRouteCard">
                  <div>
                    <strong>
                      {stop.city || stop.country}
                    </strong>

                    <small>
                      {stop.city
                        ? stop.country
                        : "Lieu enregistré"}
                    </small>
                  </div>

                  <div className="balkanRouteAmount">
                    <strong>{money(stop.amount)}</strong>

                    <small>
                      {stop.expenses}{" "}
                      {stop.expenses === 1
                        ? "dépense"
                        : "dépenses"}
                    </small>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* =================================================
          RECENT EXPENSES
         ================================================= */}

      <div className="balkanSectionHead balkanRecentHead">
        <div>
          <span>TRIP LOG</span>
          <h2>Dépenses récentes</h2>
        </div>

        <button
          type="button"
          onClick={onHistory}
          className="balkanSeeAll"
        >
          Tout voir →
        </button>
      </div>

      {recentExpenses.length === 0 ? (

        <div className="balkanEmpty">
          <span>✦</span>
          <strong>Aucune dépense</strong>
          <small>Le voyage commence ici.</small>
        </div>

      ) : (

        <div className="balkanTimeline balkanTimelinePolished">

          {recentExpenses.map((expense, index) => {
            const category =
              expense.category || "Autre";

            const balkanLocation =
              getBalkanLocation(expense);

            return (
              <button
                type="button"
                className="balkanExpenseRow"
                key={expense.id}
                onClick={() => onHistory()}
              >

                <div className="balkanTimelineMarker">
                  <span />
                  {index < recentExpenses.length - 1 && <i />}
                </div>

                <div className="balkanExpenseIcon">
                  {category.charAt(0).toUpperCase()}
                </div>

                <div className="balkanExpenseInfo">
                  {balkanLocation && (
                    <div className="balkanLocationBadge">
                      <span>{balkanLocation.flag}</span>
                      <span>
                        {balkanLocation.city ||
                          balkanLocation.country}
                      </span>
                    </div>
                  )}

                  <strong>
                    {expense.description || category}
                  </strong>

                  <span>
                    {category}
                    {expense.place ? ` · ${expense.place}` : ""}
                  </span>
                </div>

                <div className="balkanExpenseAmount">
                  <strong>{money(expense.cad)}</strong>
                  <small>{expense.date}</small>
                </div>

              </button>
            );
          })}

        </div>
      )}

      {/* =================================================
          CATEGORIES
         ================================================= */}

      {categories.length > 0 && (

        <div className="balkanCategories">

          <div className="balkanSectionHead">
            <div>
              <span>BREAKDOWN</span>
              <h2>Où part l'argent</h2>
            </div>

            <strong>
              {money(categoryTotal)}
            </strong>
          </div>

          <div className="balkanCategoryList">

            {categories.map(([category, amount], index) => {
              const percentage =
                stats.total > 0
                  ? (amount / stats.total) * 100
                  : 0;

              return (
                <div
                  className="balkanCategory"
                  key={category}
                >

                  <div className="balkanCategoryTop">
                    <div>
                      <span className={`balkanCategoryDot balkanCategoryDot${index}`} />
                      <strong>{category}</strong>
                    </div>

                    <span>
                      {money(amount)}
                    </span>
                  </div>

                  <div className="balkanCategoryTrack">
                    <i
                      style={{
                        width: `${percentage}%`,
                      }}
                    />
                  </div>

                </div>
              );
            })}

          </div>

        </div>
      )}

    </section>
  );
}


function History({ data, onBack, onEdit, onDelete }) {
  return (
    <section className="historyScreen">
      <div className="historyHeader">
        <button
          className="historyBack"
          onClick={onBack}
          aria-label="Retour à l'accueil"
        >
          <ArrowLeft size={20} strokeWidth={2.3} />
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
