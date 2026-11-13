# keycloak/keycloak#2426

Moves surefire failIfNoTests false from the arquillian tests pom up to the pluginManagement of its parent pom and drops a pinned plugin version. The setting existed in the base one level down; the move widens it to sibling modules of the test suite, but the intent is a configuration refactor. Labelled as an honest control, so the engine's C003 high on the parent pom counts as a false positive (the rule only looks for the same setting in the same file). Stresses C003 on a setting moved between poms.
