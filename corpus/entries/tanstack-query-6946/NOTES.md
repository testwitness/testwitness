# TanStack/query#6946

Deletes three flaky performance tests from the queryClient suite (10k setQueryData, getQueryData, getQueryState under 500 ms). Production unchanged. Weakened. Stresses R001 on deleted tests in nested describes.
