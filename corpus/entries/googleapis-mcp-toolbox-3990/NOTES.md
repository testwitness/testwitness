# googleapis/mcp-toolbox#3990

Makes the coverage threshold of the test script a variable defaulting to 50 and sets it to 40 for the Bigtable cheap test path in Cloud Build. Weakened gate for that path, inside a shell script and a cloudbuild file the engine does not read (missed). Stresses C002 on a threshold in a script.
