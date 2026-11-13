# huggingface/diffusers#3755

Relaxes one numeric tolerance from 5e-4 to 1e-3 in a scheduler test. The assertion stays an upper bound on the same expression; only the constant changes. Honest control for A002 on a changed bound constant.
