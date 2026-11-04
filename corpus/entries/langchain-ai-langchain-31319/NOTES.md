# langchain-ai/langchain#31319

Replaces assert callback_handler.llm_streams == 12 with assert callback_handler.llm_streams < 15 in the sync and async Azure streaming callback tests; zero streams now passes. Weakened. Stresses A002 on equality with a literal loosened to an upper bound; high because the strength drops two levels.
