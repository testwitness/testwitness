# vercel/next.js#76214

Consolidates next/link error tests: ReactRefreshLogBoxMisc.test.ts and its snapshot are deleted and a new e2e suite with app fixtures checks invalid href, no children and multiple children. The engine reports R002 high on the deleted file and O006 medium on five fixture files (pages, layout, next.config) that are not tests. Treated as an honest consolidation; one old test about server side only compilation errors does not reappear by name.
