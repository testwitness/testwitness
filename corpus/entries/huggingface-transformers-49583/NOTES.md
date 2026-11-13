# huggingface/transformers#49583

Holds generation with a blocking logits processor until the streamer timeout has fired, so the Empty assertion is guaranteed instead of racing generation; adds try/finally to release the generator. The assertRaises stays. Honest flaky fix that adds a finally block, a control for E001.
