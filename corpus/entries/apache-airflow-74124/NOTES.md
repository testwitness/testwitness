# apache/airflow#74124

Replaces sleep based polling in Kafka trigger tests with asyncio.wait_for on the next event and asserts the payload; the tombstone test is renamed and now checks that the trigger skips the tombstone and yields the next message with both offsets committed. Strengthened. Honest control.
