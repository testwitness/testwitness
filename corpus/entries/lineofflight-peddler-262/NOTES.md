# lineofflight/peddler#262

Adds continue-on-error: ${{ matrix.ruby == 'head' }} (and fail-fast: false) to the test job that runs bundle exec rake test. Failures on Ruby head no longer fail CI. Stresses W002 on a matrix expression value and a Ruby test command; the engine only matches a literal true today.
