# ray-project/ray#47092

Removes the per file assertion that written files are named data_*.parquet and replaces the ordered DataFrame equality with equality of row sets, which ignores order and duplicate rows. Weakened to make the test less brittle. Stresses A001 on a removed assertion inside a loop, alongside an ordered comparison becoming a set comparison.
