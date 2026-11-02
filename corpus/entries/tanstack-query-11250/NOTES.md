# TanStack/query#11250

The suspense regression tests in vue-query are moved from suspense.test.ts into a describe block in useQuery.test.ts. Titles are unchanged, the enclosing describe changes. Honest move. Stresses qualified name matching when the container chain changes.
