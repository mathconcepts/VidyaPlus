#!/usr/bin/env python3
"""Step 3. Train the small CNN and export it as static assets for the browser.

Usage: train.py <data-dir> <out-dir>      (data-dir from gen_data.ts train)
Writes <out-dir>/weights.json + weights.bin: conv kernels quantised to uint8
(per-tensor min/scale), biases float32. The browser builds the network from
these with TF.js ops (src/handwriting/model.ts); no model-graph JSON, no eval.
Architecture (must match model.ts): 28x28x1 -> [conv3x3x24, conv3x3x32, maxpool2]
-> [conv3x3x48, conv3x3x64, maxpool2] -> dense 64 relu -> dense 12.
"""
import json, sys
from pathlib import Path
import numpy as np
import tensorflow as tf

data, out = Path(sys.argv[1]), Path(sys.argv[2])
tf.keras.utils.set_random_seed(7)
Y = np.fromfile(data / 'train-y.bin', np.uint8).astype('int32')
X = (np.fromfile(data / 'train-x.bin', np.uint8).reshape(-1, 28, 28, 1) / 255.0).astype('float32')
n_val = 8000
Xv, Yv, Xt, Yt = X[:n_val], Y[:n_val], X[n_val:], Y[n_val:]

m = tf.keras.Sequential([
    tf.keras.layers.Input((28, 28, 1)),
    tf.keras.layers.Conv2D(24, 3, activation='relu', name='conv1'),
    tf.keras.layers.Conv2D(32, 3, activation='relu', name='conv2'),
    tf.keras.layers.MaxPool2D(2),
    tf.keras.layers.Conv2D(48, 3, activation='relu', name='conv3'),
    tf.keras.layers.Conv2D(64, 3, activation='relu', name='conv4'),
    tf.keras.layers.MaxPool2D(2),
    tf.keras.layers.Flatten(),
    tf.keras.layers.Dropout(0.2),
    tf.keras.layers.Dense(64, activation='relu', name='fc1'),
    tf.keras.layers.Dense(12, name='fc2'),
])
m.compile(tf.keras.optimizers.Adam(2e-3), tf.keras.losses.SparseCategoricalCrossentropy(from_logits=True), metrics=['accuracy'])
m.fit(Xt, Yt, validation_data=(Xv, Yv), epochs=14, batch_size=256, verbose=2,
      callbacks=[tf.keras.callbacks.ReduceLROnPlateau(factor=0.5, patience=1, min_lr=1e-4)])

entries, blob = [], bytearray()
for layer in ['conv1', 'conv2', 'conv3', 'conv4', 'fc1', 'fc2']:
    k, b = m.get_layer(layer).get_weights()
    lo, hi = float(k.min()), float(k.max())
    scale = (hi - lo) / 255 or 1.0
    q = np.round((k - lo) / scale).astype(np.uint8)
    entries.append({'name': f'{layer}/k', 'shape': list(k.shape), 'dtype': 'uint8', 'min': lo, 'scale': scale, 'offset': len(blob)})
    blob += q.tobytes()
    while len(blob) % 4: blob += b'\0'
    entries.append({'name': f'{layer}/b', 'shape': list(b.shape), 'dtype': 'float32', 'offset': len(blob)})
    blob += b.astype('<f4').tobytes()
out.mkdir(parents=True, exist_ok=True)
(out / 'weights.bin').write_bytes(bytes(blob))
(out / 'weights.json').write_text(json.dumps({'version': 1, 'classes': '0123456789.-', 'input': [28, 28, 1], 'tensors': entries}, indent=1))
print('weights.bin', len(blob), 'bytes;', 'val acc', m.evaluate(Xv, Yv, verbose=0)[1])
