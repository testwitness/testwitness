Negative control. The catch takes CartEmptyException, a specific type, not Exception or Throwable. Only that failure is absorbed, so E001 stays quiet.
