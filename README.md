# Kart Live — MVP déployable

Application React/TypeScript pour une endurance de karting : écran pilote passif, commandes depuis les stands, temps de roulage effectif, relais, ravitaillements et synchronisation Firestore.

## Démarrage immédiat (mode démo)

```bash
npm install
npm run dev
```

Ouvrir `http://localhost:5173` (stand) et `http://localhost:5173/driver` (pilote). Sans variables Firebase, les données restent locales et sont partagées **uniquement entre onglets d'un même navigateur/origine**. Ce mode ne synchronise **pas** deux téléphones.

## Mise en production multi-appareils

1. Créer un projet sur https://console.firebase.google.com/ et ajouter une application Web.
2. Activer **Authentication → Sign-in method → Email/Password** et **Anonymous**.
3. Créer un compte administrateur Email/Password dans **Authentication → Users** ; copier son **UID**.
4. Créer une base **Cloud Firestore** en mode production. Copier `firestore.rules`, remplacer `REPLACE_WITH_ADMIN_UID` par le UID exact de l'administrateur, puis **publier les règles**. **Ne jamais utiliser des règles `allow write: if true`**.
5. Copier `.env.example` en `.env.local` et remplir les valeurs Firebase (Firebase → Project settings → Your apps → SDK setup). Le champ `VITE_EVENT_ID` doit être un identifiant simple, identique sur tous les appareils.
6. `npm install && npm run build`. Sur Vercel, importer le dépôt GitHub, choisir Vite et renseigner les variables `VITE_*` dans les paramètres du projet. Déployer. Pour les URLs `/driver`, le fichier `vercel.json` gère le fallback SPA.
7. Depuis `/`, se connecter avec le compte administrateur, initialiser les données en cliquant sur **Réinitialiser la course** puis **Confirmer**. Cette opération crée le document Firestore `events/{VITE_EVENT_ID}`. Ouvrir ensuite `/driver` sur le téléphone pilote : il se connecte anonymement et reçoit les messages.
8. Tester sur deux téléphones **réels** et sur le réseau mobile du circuit. Vérifier la réception des consignes, l'expiration des messages et les coupures de connexion.

### Important : confidentialité et sécurité

- Le compte administrateur est seul autorisé à écrire. Les terminaux pilotes anonymes peuvent lire l'état de l'événement.
- Les données sont visibles par **tout utilisateur authentifié** du projet Firebase, y compris les connexions anonymes. Ne pas y placer d'informations privées. Pour un accès lecture restreint à l'équipe, ajouter un mécanisme d'invitation/authentification par utilisateur.
- La variable `VITE_*` n'est **pas secrète** : la sécurité repose sur les règles Firestore et l'authentification.
- Les commandes expirent au bout de 120 secondes sur l'interface pilote. Le témoin SYNC LIVE indique la connexion du client Firestore, **pas** que le pilote a lu la consigne.
- Si la connexion tombe, la dernière consigne peut rester visible jusqu'à son expiration : le dispositif ne doit jamais remplacer les signaux officiels de piste.
- Le mode administrateur est réservé au stand. Ne pas se connecter comme administrateur sur le téléphone pilote.

## Utilisation pendant la course

- En qualifications, sélectionner « Qualifications » et démarrer un pilote. À son retour, cliquer sur « Entrée au stand / fin du relais ». Répéter.
- Avant la course, sélectionner « Course », cliquer sur « Départ course » à l'heure réelle du départ puis « Début relais » pour le premier pilote.
- À chaque changement, arrêter le relais **à l'entrée au stand** et démarrer le suivant **à la sortie du stand**. Le temps passé aux stands est donc exclu des temps de roulage.
- Marquer les ravitaillements comme effectués uniquement après confirmation du plein. L'application n'automatise pas leur détection.
- À l'arrivée, cliquer sur « Arrivée ». Les temps cumulés qualifications + course permettent d'équilibrer les pilotes.

## Limitations de ce MVP

- Les 7 changements sont un objectif **à vérifier manuellement** : le compteur est indicatif, notamment lors de séquences interrompues ou de qualifications.
- Les temps de qualification incluent les déplacements d'entrée/sortie si le stand ne clique pas précisément au passage de la ligne choisie.
- La synchronisation est « temps réel réseau », **sans garantie de latence maximale** et sans accusé de lecture humain.
- Pas de gestion multi-équipes, ni de chronométrage automatique au tour, ni de radar météo.
- Les horaires des fenêtres de ravitaillement sont affichés, mais pas bloqués automatiquement.

## Sécurité sur piste

**Autorisation écrite ou explicite du circuit indispensable** pour le smartphone et sa fixation. Fixation sûre sans risque de chute, de contact avec la direction, les commandes ou le pilote. Affichage passif seulement : **aucune manipulation en roulant**. En cas de doute, utiliser un panneau visible depuis les stands.
