"""In-process real-time transport primitives.

The HTTP API and database remain authoritative.  This package only publishes
low-latency notifications after the normal persistence path succeeds.
"""
