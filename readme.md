kombat
======

Infrastructure for CRDT powered applications.

TODO:
- Consider a strategy to purge full messages.
  - Keep timestamps set to ensure we can dedupe when adding the the merkle.
  - Keep latest timestamps for (dataset, row, column) to ensure we don't apply old changes.
