# rjsf-team/react-jsonschema-form#1227

Allows widgets wrapped in React.forwardRef and adds a describe.only block for getWidget with three tests, one of them new and marked it.skip. Every other test in the utils test file stops running until a later PR removed the describe.only (found with git blame). Stresses R005 at describe level and R010 on a new skipped test in the same block.
