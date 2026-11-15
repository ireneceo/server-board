# /feature-design — design a large feature (kit command)

Only for large features: 3+ new tables · several APIs · role-specific screens · external integrations. Bugs and small features are done directly.
Get {{OWNER}}'s approval at each step (attach the independent reviewer's opinion if it wrote or reviewed the design):
1. Definition: name · purpose · users · 3–5 usage scenes · relation to existing features · success criteria · out of scope.
2. API: method/path · caller · auth · request · response · errors (400/401/403/404) · files.
3. Data: tables · columns · indexes · relations · migration (safe to run twice) · delete strategy · tenant separation column.
4. Screens: pages · menu · routes · role guards · empty/loading/error states · mobile · languages · reuse shared components.
5. Build: in the agreed order and scope only (don't add) · a short report per file · build passes.
6. Test: round trip · other role/tenant 403 · edge and error cases · side effects → `/verify`.
Output: `docs/<feature>_DESIGN.md` · `docs/<feature>_TESTS.md` (append to an existing doc on the same topic).
