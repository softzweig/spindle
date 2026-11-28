---
"@softzweig/spindle-memory": minor
---

Filter values compare by structure with `fast-deep-equal`, so a date, an array or a nested
object a caller built separately matches the row holding its equal instead of requiring the
same reference.
