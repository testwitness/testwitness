# huggingface/transformers#45014

Changes the test fetcher so that when only tests_hub would run because no other job has test files, no job is written at all. A CI orchestration change, not a gate on a test result. Honest control.
