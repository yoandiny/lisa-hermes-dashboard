# Wake word « Hey Lisa »

Par défaut, le HUD écoute **Hey Lisa** via la Web Speech API du navigateur (Chrome ou Edge recommandé).

## Utilisation

1. Autoriser le micro pour `127.0.0.1`.
2. Le bouton **« Hey Lisa »** au bas de l’écran active l’écoute (activé au démarrage si `WAKE_WORD=1`).
3. Dites **« Hey Lisa »** puis votre instruction, ou seulement **« Hey Lisa »** pour ouvrir le mode conversation (micro).

Exemple : *« Hey Lisa, what's the weather? »* envoie directement la question.

## Désactiver

Dans `.env` : `WAKE_WORD=0`, puis redémarrer le serveur.

## Porcupine (optionnel, plus tard)

Pour une détection hors Google Speech, créez un mot d’éveil sur [Picovoice Console](https://console.picovoice.ai/), placez le fichier `.ppn` ici et renseignez `PORCUPINE_ACCESS_KEY` + `PORCUPINE_KEYWORD_PATH` dans `.env`.