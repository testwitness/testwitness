# rails/sprockets#715

Adds job level continue-on-error: ${{ matrix.experimental }} to the CI job that runs bundle exec rake and marks jruby, jruby-head and ruby head as experimental (the old allow-failure keys were not wired to anything). Test failures on those rubies no longer fail CI. The engine matches only a literal true (missed). Stresses W002 on a matrix expression.
