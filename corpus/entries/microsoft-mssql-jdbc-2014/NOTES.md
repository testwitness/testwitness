# microsoft/mssql-jdbc#2014

Wraps the reflection that forces the metadata cache size and capacity to zero in try { ... } catch (Exception NoSuchFieldException) {}, with a comment that changing static final fields does not work after Java 17. On those runtimes the setup now fails silently and the trim test runs against the default cache sizes, so it may no longer exercise trimming at all. Weakened. Stresses E001 on an empty catch of Exception added in a test body.
