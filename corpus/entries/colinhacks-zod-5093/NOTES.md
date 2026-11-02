# colinhacks/zod#5093

Makes size based Set and File min and max checks inclusive in core/checks.ts and updates the inline snapshots in file.test.ts and set.test.ts to the new messages and the new inclusive flag. Production and snapshot change together. Honest snapshot update. Stresses snapshot rules that must credit a matching production change.
