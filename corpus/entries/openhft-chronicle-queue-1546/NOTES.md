# OpenHFT/Chronicle-Queue#1546

Deletes TestTailAfterRoll.java outright because it no longer matched current behaviour. The file held one @Test (already @Ignore). Stresses R002 on a deleted test file whose only test was ignored.
