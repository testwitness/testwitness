# microsoft/playwright#15397

Changes expect(error.message).toBe('sad :(') to toContain('sad :(') so extra text around the message passes, to accommodate WebKit. Weakened. Stresses A002 on exact to contains on the same subject.
