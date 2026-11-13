# transloadit/uppy#3662

Stabilises Cypress tests and adds an e2e test for error events as it.only. The other tests in the Tus dashboard spec stop running until a later PR removed the marker (found with git blame). Stresses R005 on a Cypress spec.
