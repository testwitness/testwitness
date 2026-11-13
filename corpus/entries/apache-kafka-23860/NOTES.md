# apache/kafka#23860

Replaces try { ...; fail() } catch patterns with assertThrows in Connect tests and keeps the checks on the caught exception. Honest migration and a control for A001 and E001.
