# xerial/snappy-java#745

Removes the big endian branch with its assertEquals on compressed size. Weakened on that platform. Stresses A001 when the removed assertion sat inside a conditional.
