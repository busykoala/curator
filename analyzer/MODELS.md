# Audio models

The analyzer image contains these Essentia models, fetched from
https://essentia.upf.edu/models/ at build time and verified against `models.sha256`:

- Discogs-EffNet feature extractor (`discogs-effnet-bs64-1`): 1280-d embeddings
- Classification heads on its embeddings: `genre_discogs400`, `voice_instrumental`,
  `danceability`, `mtg_jamendo_instrument`, `mood_aggressive`, `mood_happy`,
  `mood_relaxed`, `mood_sad`

Models by the Music Technology Group, Universitat Pompeu Fabra, licensed under
CC BY-NC-SA 4.0 (https://creativecommons.org/licenses/by-nc-sa/4.0/). They are
used here for personal, non-commercial library curation only.
