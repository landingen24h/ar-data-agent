#!/bin/sh
# Downloads the two public domain sources named in SOURCES.txt into src/ so that render.py can rebuild film.mp4 from edit.json.
set -e
mkdir -p src
UA="kreativ-editor-audition/1.0 (https://github.com/landingen24h/ar-data-agent/tree/seat-kreativ-editor-audition)"
curl -fL -A "$UA" -o src/manhatta_1921.webm "https://upload.wikimedia.org/wikipedia/commons/0/00/Manhatta_%281921%29.webm"
curl -fL -A "$UA" -o src/maple_leaf_rag_joplin_1916.ogg "https://upload.wikimedia.org/wikipedia/commons/d/db/Maple_leaf_rag_-_played_by_Scott_Joplin_1916_V2.ogg"
sha256sum src/*
