# Kart Live — Déploiement Firebase Hosting

Application React + TypeScript + Vite, avec Firestore pour les messages temps réel et Firebase Authentication pour les accès.

## 1. Prérequis

- Node.js 20 ou plus récent, npm et un compte Google.
- Créer un projet dans https://console.firebase.google.com/.
- Dans **Paramètres du projet > Vos applications**, enregistrer une application **Web** et relever `apiKey`, `authDomain`, `projectId`, `appId`.

## 2. Activer les services Firebase

1. **Authentication > Sign-in method** : activer **E-mail/Mot de passe** et **Anonyme**.
2. **Authentication > Users** : créer le compte de l'administrateur du stand et copier son **UID**.
3. **Firestore Database** : créer la base `(default)` en mode production, dans une région appropriée.
4. Vérifier que l'UID du compte administrateur est `k080KWL0WJTnbHzEJARVLfdzKWo1`. Si le compte est différent, remplacer cet UID dans `firestore.rules` et la constante `ADMIN_UID` dans `src/main.tsx`, puis recompiler l'application et publier les règles.

Les règles du projet autorisent la lecture aux utilisateurs authentifiés (y compris anonymes) et l'écriture uniquement au compte administrateur. Ne jamais déployer avec des règles ouvertes (`allow write: if true`). Ne pas enregistrer de données sensibles dans l'événement.

## 3. Configurer l'application

Depuis le répertoire `kart-live` :

```bash
npm install
cp .env.example .env.local
```

Renseigner `.env.local` avec les valeurs de l'application Web Firebase :

```dotenv
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=TON-PROJET.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=TON-PROJET
VITE_FIREBASE_APP_ID=...
VITE_EVENT_ID=lille-endurance-2026
```

Les variables `VITE_*` sont intégrées au bundle client : ce ne sont pas des secrets. La sécurité repose sur Authentication et les règles Firestore. Ne pas versionner `.env.local`.

## 4. Installer Firebase CLI et associer le projet

```bash
npm install -g firebase-tools
firebase login
firebase use --add
```

Sélectionner le projet Firebase existant et lui donner un alias, par exemple `default`. Si la commande `firebase use --add` ne fonctionne pas, utiliser `firebase use --project TON-PROJET` ou `firebase deploy --project TON-PROJET`.

Les fichiers `firebase.json` et `firestore.rules` sont déjà fournis. `firebase.json` définit `dist` comme répertoire publié, une réécriture SPA pour `/driver`, et le chemin des règles Firestore.

## 5. Compiler et déployer

```bash
npm run build
firebase deploy --only hosting,firestore:rules
```

Si la compilation échoue, corriger les erreurs avant le déploiement. L'application sera disponible à :

- `https://TON-PROJET.web.app/` — stand
- `https://TON-PROJET.web.app/driver` — pilote

Pour les déploiements suivants :

```bash
npm run build
firebase deploy --only hosting
```

Redéployer `firestore:rules` si les règles changent. La publication des règles peut prendre un court délai avant d'être effective.

## 6. Initialiser et tester

1. Ouvrir `/` et se connecter avec l'e-mail/mot de passe administrateur.
2. Initialiser la course avec **Réinitialiser la course**, puis **Confirmer**. Cela crée `events/{VITE_EVENT_ID}`.
3. Ouvrir `/driver` sur un autre téléphone. L'authentification anonyme permet la lecture.
4. Envoyer `BOX`, `PUSH`, `STAY OUT` depuis le stand et vérifier la réception en temps réel.
5. Tester en réseau mobile, téléphone verrouillé/déverrouillé, et lors d'une perte de connexion. Ne jamais présumer qu'une consigne a été lue.

## 7. Chronométrage de course

- Qualifications : A 10 min, B 5 min, C 5 min, D 0 min (plan initial, ajustable).
- Course : 10h35–14h35 ; 7 changements de pilote minimum.
- Ravitaillement 1 : 11h50–12h20 ; ravitaillement 2 : 13h05–13h35.
- Pour exclure les arrêts du temps de roulage, arrêter le relais à l'entrée aux stands et démarrer le suivant à la sortie.
- Les temps réels d'attente et de ravitaillement doivent être relevés ; le compteur ne remplace pas le chronométrage officiel.

## 8. Sécurité et limites

- **Obtenir l'autorisation explicite de Lille Karting** avant de fixer un téléphone au kart.
- Fixation sûre, sans gêner les commandes ni la visibilité ; aucune manipulation en roulant.
- La connexion temps réel dépend du réseau ; les consignes peuvent être retardées ou perdues.
- L'interface pilote ne prouve pas que le pilote a vu le message ; les consignes officielles du circuit restent prioritaires.
- En mode sans Firebase, le fonctionnement local n'est pas synchronisé entre deux appareils.
- MVP non testé en conditions réelles ; valider le build et faire une répétition avant la course.

## Dépannage

- **Page blanche sur `/driver`** : vérifier le `rewrites` SPA de `firebase.json`, puis redéployer Hosting.
- **`permission-denied` Firestore** : vérifier UID administrateur, règles publiées, Authentication activé et bon projet.
- **Tous les enregistrements sont refusés malgré le bon compte** : publier les règles actuelles avec `firebase deploy --only firestore:rules --project TON-PROJET`. Chaque action enregistre simultanément `events/{eventId}`, `events/{eventId}/races/{raceId}` et `events/{eventId}/history/{historyId}`. Firestore refuse tout le lot si un seul de ces chemins n'est pas autorisé ; les règles du document parent ne couvrent pas automatiquement les sous-collections.
- **Données non synchronisées** : vérifier `.env.local`, `VITE_EVENT_ID`, accès réseau et connexion Firebase des deux appareils.
- **Ancienne version visible** : recompiler avec `npm run build` avant `firebase deploy`.
