# mongodb/node-mongodb-native#4449

In four consecutive resume tests, replaces the exact chai assertion that six aggregate commands were sent with a check that more than one was sent. Weakened to fix flakiness: any number of resume attempts above one now passes. Stresses A002 on chai equality loosened to a comparison where the subject also moves from the array to its length property.
