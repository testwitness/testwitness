# vercel/next.js#99371

Updates stale inline snapshot text in a test utility after unstable_prefetch was renamed to prefetch. The production rename landed earlier. Honest snapshot update. Stresses inline snapshot edits inside a helper file rather than a test file.
