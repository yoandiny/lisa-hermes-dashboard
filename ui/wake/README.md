# Wake word « Hey Lisa »

- **Avec `ELEVENLABS_API_KEY`** : wake via enregistrement micro + STT (fonctionne sur **Brave**, Firefox, etc.).
- **Sans ElevenLabs** : wake via Web Speech API (**Chrome / Edge** uniquement — **pas Brave**).

## Utilisation

1. Autoriser le micro pour ce site (`127.0.0.1` ou HTTPS).
2. **Mobile** : touchez **« Hey Lisa »** une fois (le navigateur exige un geste utilisateur pour le micro).
3. **Brave** : configurez ElevenLabs, puis activez **« Hey Lisa »** (pas d’autostart).
4. Sur desktop Chrome, l’écoute peut démarrer seule si `WAKE_WORD=1`.
3. Dites **« Hey Lisa »** puis votre instruction, ou seulement **« Hey Lisa »** pour ouvrir le mode conversation (micro).

Deux temps : dites **« Hey Lisa »** (signal sonore), puis **votre demande** dans le silence qui suit — pas besoin d’une seule phrase.

Après avoir **coupé le micro** ou dit une phrase de fin (« merci », « c’est tout », « à plus », etc.), la conversation se ferme et **« Hey Lisa »** se réactive pour le prochain tour (si le bouton reste activé).

## Désactiver

Dans `.env` : `WAKE_WORD=0`, puis redémarrer le serveur.

## Porcupine (optionnel, plus tard)

Pour une détection hors Google Speech, créez un mot d’éveil sur [Picovoice Console](https://console.picovoice.ai/), placez le fichier `.ppn` ici et renseignez `PORCUPINE_ACCESS_KEY` + `PORCUPINE_KEYWORD_PATH` dans `.env`.