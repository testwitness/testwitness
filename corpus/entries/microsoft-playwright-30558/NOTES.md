# microsoft/playwright#30558

Comments out expect(result.didNotRun).toBe(1) in a reporter test while keeping the other assertions; the commit calls it relaxing the expectation. Weakened. Stresses A001 on an assertion removed by commenting it out inside a test generated in a loop with a template title.
