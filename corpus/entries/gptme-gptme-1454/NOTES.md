# gptme/gptme#1454

Turns the test matrix into include entries and adds job level continue-on-error: ${{ matrix.experimental || false }}, with the GLM-5 model row marked experimental. Test failures for that model no longer fail CI. The engine matches only a literal true (missed). Stresses W002 on a matrix expression.
