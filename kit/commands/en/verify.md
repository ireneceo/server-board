# /verify — check your own work (kit command)

"I read the code and it looks right" is not verification. Show **real run results**. If anything fails, don't write "done".

0. If "Automated checks" is set, run it first. Not 0 → stop and fix.
1. **Build** ("Build"; if the memory gate blocks, wait — never bypass): 0 errors.
2. **Restart and logs**: "Restart" → no new errors in "Logs" · "Health check" passes.
3. **Real calls**: log in → create/update/delete → read back and compare (round trip) · error cases (empty, duplicate, huge values) · unauthorized users and other tenants' data are refused (401/403).
4. **User flows**: per role, log in → act → save → reload, still the same.
5. **Real browser**: open the changed screens and the "key screens": no freezes, 0 console errors (a passing build ≠ a safe screen).
6. **Side effects**: other screens using the same shared parts.
7. **Request checklist**: every requested item ✓/✗ with evidence.

Rules: test on dev servers and test accounts only (never production) · delete temporary test files · never change the pass criteria or business rules to make a test pass · payments in test mode only.
This is *self*-verification. Items in "Must get independent review" also need `/fable-verify`.
