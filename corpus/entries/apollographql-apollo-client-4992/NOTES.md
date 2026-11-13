# apollographql/apollo-client#4992

Makes ObservableQuery.lastResult keep track of errors and adds a client test as it.only. The rest of the large client test file stops running until a later PR titled Remove .only in client tests (introducing PR found with git blame on the line it removed). Stresses R005 in a large test file.
