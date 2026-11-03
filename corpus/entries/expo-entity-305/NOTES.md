# expo/entity#305

Adds support for Buffer fields with a new describe.only block in the Postgres integration test. Every other test in that file stops running. The follow up PR fixed the erroneous describe.only and added a lint rule. Stresses R005 on a new focused describe.
