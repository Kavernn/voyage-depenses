# Voyage Dépenses

MVP responsive/PWA basé sur le cahier des charges fourni.

## Lancer
```bash
npm install
npm run dev
```

Puis ouvrir l'adresse indiquée par Vite. Pour le téléphone, déployer ensuite sur Vercel/Netlify et ouvrir l'URL depuis l'iPhone/Android.

## Ce MVP inclut
- création/modification du voyage
- 2 voyageurs
- ajout rapide de dépenses
- CAD comme devise de référence
- conversion automatique des devises avec cache local
- taux enregistré avec chaque dépense
- dépenses personnelles ou partagées
- partage personnalisable
- tableau de bord
- historique / modification / suppression
- PWA responsive

## Limite actuelle
Les données sont stockées localement dans le navigateur. Une version suivante peut ajouter Supabase pour synchroniser les données entre téléphone et ordinateur et gérer les remboursements, filtres, statistiques et exports.
