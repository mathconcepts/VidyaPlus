#!/usr/bin/env python3
"""S2 'real tutor chat' step (plan R11/R22: a real chat with a per-run spend cap, retried once).

Gated on VIDHYA_IT_LLM_KEY. NOT IMPLEMENTED YET: configuring DeepTutor's LLM through the
gateway (v5 P3, with the hard spend cap) needs the gateway endpoint, which does not exist
in this repo. Until then this exits 0 and says so; it never pretends to have run a chat.
"""
import os
import sys

if not os.environ.get("VIDHYA_IT_LLM_KEY"):
    print("SKIP: no VIDHYA_IT_LLM_KEY; the real tutor chat step did not run (S2-h stays UNKNOWN)")
    sys.exit(0)
print("::warning::VIDHYA_IT_LLM_KEY is set but chat_smoke.py is not implemented (needs the P3 gateway endpoint); no chat was run")
sys.exit(0)
