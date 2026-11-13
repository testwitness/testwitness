# fastify/fastify-request-context#50

Switches the main test run to TAP and keeps the Jest suite in a new CI-jest workflow whose Run Tests step has continue-on-error: true, so Jest failures never fail CI. Weakened for the Jest suite. The engine also reports O001 low on new TAP tests it does not read as asserting (t.plan and t.equal), which are informational. Stresses W002 on a new workflow.
