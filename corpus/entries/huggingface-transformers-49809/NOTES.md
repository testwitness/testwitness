# huggingface/transformers#49809

Adds three new test method overrides whose body is pass and which carry unittest.skip with a reason. They exist only to switch off the inherited test. Stresses R010 on new tests born skipped.
