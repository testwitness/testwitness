# micronaut-projects/micronaut-core#12499

Replaces assertEquals on the complete JSON error response (message, path and links) with assertTrue on a newline normalised body containing the error message. Weakened: path, status message and links are no longer checked. Stresses A002 on exact to contains in JUnit where the subject changes to a normalised local.
