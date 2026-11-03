# flutter/flutter-intellij#5715

Deletes two obsolete tests from FlutterModuleUtilsTest while the production method stays, and loosens an assertEquals(1, callCount) to assertNotEquals(0, callCount) in ProjectWatchTest. Stresses R001 and A002 together.
