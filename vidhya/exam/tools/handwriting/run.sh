#!/usr/bin/env bash
# Reproduce the handwriting model and its evaluation set (T31). Needs: node + `npm ci` in vidhya/,
# python3 with `pip install -r requirements.txt`, and the four MNIST idx .gz files in $MNIST_DIR
# (e.g. https://raw.githubusercontent.com/golbin/TensorFlow-MNIST/master/mnist/data/<file>);
# extract_strokes.py checks their SHA-256. Intermediate data goes to $WORK (default /tmp), never into the repo.
#
#   MNIST_DIR=/tmp/mnist ./run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
exam="$(cd "$here/../.." && pwd)"
: "${MNIST_DIR:?set MNIST_DIR to the folder holding the MNIST .gz files}"
WORK="${WORK:-/tmp/vidhya-handwriting}"
mkdir -p "$WORK"
python3 "$here/extract_strokes.py" "$MNIST_DIR" "$WORK/strokes"
cd "$exam"
npx vite-node tools/handwriting/gen_data.ts train "$WORK/strokes" "$WORK/data"
npx vite-node tools/handwriting/gen_data.ts eval "$WORK/strokes" tools/handwriting/eval/eval-set.json
python3 "$here/train.py" "$WORK/data" public/handwriting
npx vitest run src/handwriting/eval.test.ts
