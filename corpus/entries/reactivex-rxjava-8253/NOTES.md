# ReactiveX/RxJava#8253

Race based TestHelper tests are cut from six operator test classes and pasted into new @Isolated classes so they do not interfere with parallel runs. Method bodies are unchanged. Honest move. Stresses Java move detection across new files and the handling of new test classes that only exist in head.
