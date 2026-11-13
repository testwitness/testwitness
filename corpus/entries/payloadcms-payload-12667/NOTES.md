# payloadcms/payload#12667

Adds an early return to a queues integration test when the database adapter is Supabase, with a TODO saying it is flaky there. A conditional skip for one database variant, written as a return; the test still runs on the other adapters. Labelled as the expected low conditional signal, which the engine does not emit.
