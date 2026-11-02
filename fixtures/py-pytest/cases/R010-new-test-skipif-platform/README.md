The new test has a skipif on sys.platform. The condition is dynamic, so the test runs on most platforms and is real coverage; R010 does not fire and the test has an assertion so O001 is quiet too.
