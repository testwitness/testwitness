# pola-rs/polars#29983

Moves SQL read_csv option tests from a Rust test module to Python tests and drops the tempfile dev dependency. The Rust deletions are outside the front ends. Honest move between languages.
