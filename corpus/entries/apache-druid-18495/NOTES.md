# apache/druid#18495

Overrides an inherited test method only to add @Disabled("Disabled due to flakiness after segment drops") and call super. Weakened. Stresses R003 when the disabled method is new in the subclass but existed through inheritance in the base.
