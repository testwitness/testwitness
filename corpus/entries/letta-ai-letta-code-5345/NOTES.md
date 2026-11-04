# letta-ai/letta-code#5345

Replaces an exact toBe on the trimmed subagent report with toContain on the untrimmed result, so any surrounding text the model adds now passes. The comment explains the token is unique, so containment is judged enough. Weakened. Stresses A002 on exact to contains where the subject also drops a trailing .trim() call, which defeats subject pairing in the engine today.
