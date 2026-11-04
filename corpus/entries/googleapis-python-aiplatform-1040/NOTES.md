# googleapis/python-aiplatform#1040

System test for the feature store: exact count assertions on listed featurestores, entity types and features become membership checks on resource names, and the empty list checks before creation are removed. Weakened: extra or duplicate resources now pass. Stresses A002 on len(x) == n loosened to name in [...] where the subject changes; the engine reports only a low assertions moved finding.
